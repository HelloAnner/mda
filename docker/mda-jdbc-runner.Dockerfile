FROM maven:3.9.11-eclipse-temurin-21-alpine AS build
WORKDIR /app
COPY connectors/jdbc-runner/pom.xml ./pom.xml
COPY connectors/jdbc-runner/src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=build /app/target/jdbc-runner-0.1.0.jar ./jdbc-runner.jar
RUN addgroup -S mda && adduser -S -G mda mda
USER mda
CMD ["java", "-jar", "/app/jdbc-runner.jar"]
