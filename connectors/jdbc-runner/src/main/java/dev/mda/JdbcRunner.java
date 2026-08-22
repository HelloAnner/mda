package dev.mda;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.Executors;

public final class JdbcRunner {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final String TOKEN = required("JDBC_RUNNER_TOKEN");

  public static void main(String[] args) throws Exception {
    int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8082"));
    HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
    server.createContext("/health", exchange -> respond(exchange, 200, Map.of("status", "ok")));
    server.createContext("/v1/test", exchange -> handle(exchange, true));
    server.createContext("/v1/execute", exchange -> handle(exchange, false));
    server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
    server.start();
    System.out.println("{\"event\":\"jdbc-runner.started\",\"port\":" + port + "}");
  }

  private static void handle(HttpExchange exchange, boolean test) throws IOException {
    if (!"POST".equals(exchange.getRequestMethod())) {
      respond(exchange, 405, error("METHOD_NOT_ALLOWED", "Method not allowed"));
      return;
    }
    String authorization = exchange.getRequestHeaders().getFirst("Authorization");
    if (!Objects.equals(authorization, "Bearer " + TOKEN)) {
      respond(exchange, 401, error("UNAUTHENTICATED", "Invalid internal token"));
      return;
    }
    try {
      Map<String, Object> request = JSON.readValue(
          exchange.getRequestBody(), new TypeReference<Map<String, Object>>() {});
      respond(exchange, 200, execute(request, test));
    } catch (IllegalArgumentException exception) {
      respond(exchange, 400, error("SQL_INVALID", exception.getMessage()));
    } catch (Exception exception) {
      respond(exchange, 502, error("JDBC_EXECUTION_FAILED", "JDBC operation failed"));
    }
  }

  private static Map<String, Object> execute(Map<String, Object> request, boolean test) throws Exception {
    if (!"postgresql".equals(request.get("driverId"))) {
      throw new IllegalArgumentException("JDBC driver is not allowlisted");
    }
    String url = string(request, "jdbcUrl");
    if (!url.startsWith("jdbc:postgresql://")) {
      throw new IllegalArgumentException("JDBC URL is not allowed");
    }
    String sql = test ? "SELECT 1 AS connection_test" : string(request, "sql");
    validateSql(sql);
    int timeoutMs = integer(request, "statementTimeoutMs", 10_000);
    int maxRows = integer(request, "maxRows", 5_000);
    long started = System.nanoTime();
    Properties properties = new Properties();
    properties.setProperty("user", string(request, "username"));
    properties.setProperty("password", string(request, "password"));
    properties.setProperty("connectTimeout", String.valueOf(Math.max(1, integer(request, "connectionTimeoutMs", 5_000) / 1000)));
    try (Connection connection = DriverManager.getConnection(url, properties)) {
      connection.setReadOnly(true);
      connection.setAutoCommit(false);
      try (Statement policy = connection.createStatement()) {
        policy.execute("SET TRANSACTION READ ONLY");
      }
      try (PreparedStatement statement = connection.prepareStatement(sql)) {
        statement.setQueryTimeout(Math.max(1, timeoutMs / 1000));
        statement.setMaxRows(maxRows);
        List<?> parameters = (List<?>) request.getOrDefault("parameters", List.of());
        for (int index = 0; index < parameters.size(); index++) {
          statement.setObject(index + 1, parameters.get(index));
        }
        try (ResultSet result = statement.executeQuery()) {
          ResultSetMetaData metadata = result.getMetaData();
          List<Map<String, Object>> columns = new ArrayList<>();
          for (int index = 1; index <= metadata.getColumnCount(); index++) {
            columns.add(Map.of(
                "name", metadata.getColumnLabel(index),
                "type", type(metadata.getColumnType(index)),
                "nullable", metadata.isNullable(index) != ResultSetMetaData.columnNoNulls));
          }
          List<Map<String, Object>> rows = new ArrayList<>();
          while (result.next() && rows.size() < maxRows) {
            Map<String, Object> row = new LinkedHashMap<>();
            for (int index = 1; index <= metadata.getColumnCount(); index++) {
              row.put(metadata.getColumnLabel(index), value(result.getObject(index)));
            }
            rows.add(row);
          }
          connection.rollback();
          return Map.of(
              "rows", rows,
              "columns", columns,
              "durationMs", Math.max(0, (System.nanoTime() - started) / 1_000_000));
        }
      }
    }
  }

  private static void validateSql(String sql) {
    String normalized = sql.strip().toLowerCase(Locale.ROOT);
    if (!(normalized.startsWith("select ") || normalized.startsWith("with ")) || normalized.contains(";")) {
      throw new IllegalArgumentException("Only one read-only SELECT statement is allowed");
    }
    for (String forbidden : List.of(" insert ", " update ", " delete ", " merge ", " alter ", " drop ", " create ", " grant ", " revoke ", " copy ", " call ")) {
      if ((" " + normalized + " ").contains(forbidden)) {
        throw new IllegalArgumentException("SQL contains a prohibited operation");
      }
    }
  }

  private static Object value(Object value) {
    if (value instanceof BigDecimal decimal) return decimal.toPlainString();
    if (value instanceof Timestamp timestamp) return timestamp.toInstant().atOffset(ZoneOffset.UTC).toString();
    if (value instanceof java.sql.Date date) return date.toLocalDate().toString();
    if (value instanceof byte[]) return null;
    return value;
  }

  private static String type(int sqlType) {
    return switch (sqlType) {
      case Types.BOOLEAN, Types.BIT -> "boolean";
      case Types.TINYINT, Types.SMALLINT, Types.INTEGER, Types.BIGINT -> "integer";
      case Types.FLOAT, Types.REAL, Types.DOUBLE -> "number";
      case Types.NUMERIC, Types.DECIMAL -> "string";
      case Types.DATE -> "date";
      case Types.TIMESTAMP, Types.TIMESTAMP_WITH_TIMEZONE -> "datetime";
      default -> "string";
    };
  }

  private static String string(Map<String, Object> value, String key) {
    Object result = value.get(key);
    if (!(result instanceof String text) || text.isBlank()) throw new IllegalArgumentException(key + " is required");
    return text;
  }

  private static int integer(Map<String, Object> value, String key, int fallback) {
    Object result = value.get(key);
    return result instanceof Number number ? number.intValue() : fallback;
  }

  private static Map<String, Object> error(String code, String message) {
    return Map.of("code", code, "message", message, "retryable", false);
  }

  private static void respond(HttpExchange exchange, int status, Object value) throws IOException {
    byte[] body = JSON.writeValueAsBytes(value);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(status, body.length);
    exchange.getResponseBody().write(body);
    exchange.close();
  }

  private static String required(String name) {
    String value = System.getenv(name);
    if (value == null || value.length() < 32) throw new IllegalStateException(name + " is required");
    return value;
  }
}
