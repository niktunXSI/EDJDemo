import { json, readJson, route } from "@/lib/server/http";
import { addNote } from "@/lib/server/requests";
import { requireUiSession } from "@/lib/server/session";
import { noteSchema } from "@/lib/validation";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireUiSession(request);
  const { id } = await params;
  const { body } = noteSchema.parse(await readJson(request));
  return json({ id: await addNote(id, body, actor) }, 201);
});
