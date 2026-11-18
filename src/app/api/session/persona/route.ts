import { z } from "zod";
import { ApiError, json, readJson, route } from "@/lib/server/http";
import { listPersonas, requireUiSession } from "@/lib/server/session";
import { PERSONA_COOKIE } from "@/lib/session-constants";

const schema = z.object({ personaId: z.string().min(1) });

export const POST = route(async (request: Request) => {
  await requireUiSession(request);
  const { personaId } = schema.parse(await readJson(request));
  const persona = (await listPersonas()).find((p) => p.id === personaId);
  if (!persona) throw new ApiError(422, "unknown_persona", "That demo persona does not exist.");
  const response = json({ persona });
  response.cookies.set(PERSONA_COOKIE, persona.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
});
