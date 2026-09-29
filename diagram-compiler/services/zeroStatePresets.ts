export type ZeroStatePreset = {
  id: string;
  label: string;
  prompt: string;
};

export const DEFAULT_ZERO_STATE_PRESETS: ZeroStatePreset[] = [
  {
    id: "ride-hailing",
    label: "Ride hailing",
    prompt: "Design the architecture of a ride-hailing platform: rider app, driver app, matching, trips, payments, notifications, and observability.",
  },
  {
    id: "saas-billing",
    label: "SaaS billing",
    prompt: "Design a SaaS billing system with plans, subscriptions, invoices, payment provider webhooks, retries, entitlements, and audit logs.",
  },
  {
    id: "cicd",
    label: "CI/CD pipeline",
    prompt: "Design a CI/CD pipeline from pull request to production, including tests, artifacts, preview environments, approvals, deployment, rollback, and monitoring.",
  },
];
