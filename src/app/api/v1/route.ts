import { config } from "@/lib/server/config";
import { baseUrlFrom, json, route } from "@/lib/server/http";
import { WEBHOOK_SCHEMA_VERSION } from "@/lib/domain";

export const GET = route(async (request: Request) => {
  const base = `${baseUrlFrom(request, config.appBaseUrl)}/api/v1`;
  return json({
    name: "Edward Jones | Client Product Insights — Agent API",
    version: "v1",
    webhookSchemaVersion: WEBHOOK_SCHEMA_VERSION,
    authentication: "Send `Authorization: Bearer <AGENT_API_KEY>` on every request below.",
    documentation: `${baseUrlFrom(request, config.appBaseUrl)}/integrations?tab=api`,
    endpoints: {
      listRequests: `GET ${base}/requests?automationStatus=queued&page=1&pageSize=25`,
      getRequest: `GET ${base}/requests/{id}`,
      getActivity: `GET ${base}/requests/{id}/activity`,
      claimRequest: `POST ${base}/requests/{id}/claim`,
      claimNext: `POST ${base}/automation/claim-next`,
      updateAutomationStatus: `POST ${base}/requests/{id}/automation-status`,
      attachExternalReference: `PUT ${base}/requests/{id}/external-reference`,
      recordResult: `POST ${base}/requests/{id}/result`,
      dispatchDeliveries: `POST ${base}/webhooks/dispatch`,
    },
  });
});
