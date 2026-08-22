let revision = 1;

function dataset() {
  const now = new Date();
  const shift = revision - 1;
  return {
    revision,
    updatedAt: now.toISOString(),
    kpis: [
      {
        id: "revenue",
        label: "Net revenue",
        value: 2845000 + shift * 12500,
        target: 2700000,
        unit: "USD",
        change: 8.4,
      },
      {
        id: "margin",
        label: "Gross margin",
        value: 42.8 + shift * 0.1,
        target: 41.5,
        unit: "%",
        change: 1.9,
      },
      {
        id: "orders",
        label: "Orders",
        value: 18420 + shift * 37,
        target: 18000,
        unit: "count",
        change: 5.2,
      },
      {
        id: "risk",
        label: "At-risk revenue",
        value: 186000 - shift * 800,
        target: 150000,
        unit: "USD",
        change: -3.1,
      },
    ],
    trend: Array.from({ length: 12 }, (_, index) => ({
      period: `2026-${String(index + 1).padStart(2, "0")}`,
      revenue:
        1900000 + index * 81000 + ((index * 47) % 5) * 19000 + shift * 2500,
      target: 1950000 + index * 76000,
    })),
    regions: [
      {
        region: "North America",
        revenue: 1120000 + shift * 4200,
        attainment: 106,
        margin: 44.2,
        status: "ahead",
      },
      {
        region: "Europe",
        revenue: 780000 + shift * 3100,
        attainment: 101,
        margin: 43.1,
        status: "on-track",
      },
      {
        region: "Asia Pacific",
        revenue: 625000 + shift * 4800,
        attainment: 97,
        margin: 40.8,
        status: "watch",
      },
      {
        region: "Latin America",
        revenue: 320000 + shift * 900,
        attainment: 91,
        margin: 38.4,
        status: "risk",
      },
    ],
    initiatives: [
      {
        name: "Enterprise renewal motion",
        owner: "Revenue Ops",
        progress: 78,
        impact: 420000,
        status: "on-track",
      },
      {
        name: "APAC channel acceleration",
        owner: "Regional GM",
        progress: 61,
        impact: 285000,
        status: "watch",
      },
      {
        name: "Margin recovery program",
        owner: "Finance",
        progress: 84,
        impact: 198000,
        status: "on-track",
      },
      {
        name: "LATAM pipeline conversion",
        owner: "Sales",
        progress: 43,
        impact: 164000,
        status: "risk",
      },
    ],
    alerts: [
      {
        severity: "high",
        message: "LATAM attainment remains below 92%",
        owner: "Sales",
        ageHours: 5,
      },
      {
        severity: "medium",
        message: "APAC margin is 70 bps below plan",
        owner: "Finance",
        ageHours: 11,
      },
      {
        severity: "low",
        message: "Renewal coverage improved to 3.4×",
        owner: "Revenue Ops",
        ageHours: 2,
      },
    ],
  };
}

Bun.serve({
  hostname: "0.0.0.0",
  port: Number(Bun.env.PORT ?? 8090),
  routes: {
    "/": () => Response.json({ service: "mda-enterprise-fixture", revision }),
    "/enterprise": () => Response.json(dataset()),
    "/advance": {
      POST: () => {
        revision += 1;
        return Response.json({ revision });
      },
    },
    "/health": () => Response.json({ status: "ok" }),
  },
});
