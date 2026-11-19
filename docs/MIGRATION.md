# Moving Client Product Insights to another Cursor account

Everything needed to rebuild the setup is in two GitHub repositories:

| Repository | Contains |
| --- | --- |
| [niktunXSI/EDJDemo](https://github.com/niktunXSI/EDJDemo) | The full app: code, migrations, seed data, tests, docs, and the automation helper and prompt (`automation/`) |
| [niktunXSI/EDJ-Application](https://github.com/niktunXSI/EDJ-Application) | Where issues are created; the automation runs here and has a copy of `automation/` |

What does **not** move: the published app's database (synthetic demo data reseeds automatically on first use, so any requests you created yourself are lost), its generated API key and signing secret, Cloud Agent secrets, and the automation itself. You recreate those in the new account with the steps below. Most of it is copy and paste.

## 1. Connect GitHub in the new account

In the new Cursor account, connect GitHub (Dashboard → Integrations → GitHub) and give the Cursor GitHub app access to `niktunXSI/EDJDemo` and `niktunXSI/EDJ-Application`.

## 2. Publish the app from the new account

Start a Cloud Agent on **niktunXSI/EDJDemo** (branch `main`) and paste this kickoff prompt:

```
This repository is "Edward Jones | Client Product Insights", a finished Next.js + PostgreSQL app. Read README.md and docs/MIGRATION.md first. Do not redesign or rewrite the app.

1. Install dependencies (npm install), then run npm run lint, npm run typecheck, and npm test. All tests must pass.
2. Start the dev server in tmux: env -u DATABASE_URL npm run dev (port 4317). Local runs use the embedded PGlite database.
3. Publish the app with the publish-app tool (project folder = repository root, suggested name "client-product-insights", preview_url http://127.0.0.1:4317). The app declares its own Postgres database in cursor-app.json; migrations run during npm run build.
4. Declare the app secret APP_ADMIN_EMAILS with bind-app-secrets, so I can enter my email as the app administrator.
5. If the publish security review blocks something, explain the finding and fix only that.
6. When the app is live, tell me its URL and remind me of the remaining steps in docs/MIGRATION.md.
```

When the secrets card appears, enter your new account's sign-in email for `APP_ADMIN_EMAILS`, then confirm the publish. Choose **private** unless teammates need access.

## 3. Collect the values the automation needs

1. **App address:** the new live URL from step 2 (`CPI_BASE_URL`).
2. **Agent API key:** in the new app, go to Integrations → Connection → Agent API key → **Reveal**, then **Copy** (`CPI_API_KEY`).
3. **Cursor API key:** a personal API key from the new account's dashboard (`CURSOR_APP_TOKEN`). It lets the agent past the app's sign-in. If the new account belongs to a team, a team admin must turn on **Allow API keys opening apps**. Also check whether the team has an **IP allow list**: that is what blocked the webhook and the agent in the previous account.
4. **GitHub token:** reuse your fine-grained token (Issues read and write on EDJ-Application), or create a new one (`GITHUB_TOKEN`).

## 4. Add Cloud Agent secrets in the new account

Dashboard → Cloud Agents → Secrets (runtime secrets if offered):

| Name | Value |
| --- | --- |
| `CPI_BASE_URL` | The new app URL |
| `CPI_API_KEY` | The new app's Agent API key |
| `CURSOR_APP_TOKEN` | The new account's personal Cursor API key |
| `GITHUB_TOKEN` | GitHub token with Issues read/write on EDJ-Application |
| `GITHUB_REPO` | `niktunXSI/EDJ-Application` |
| `ALLOW_PUBLIC_ISSUES` | `true` (EDJ-Application is public and the app holds synthetic data) |

## 5. Check every connection before creating the automation

In any Cloud Agent on EDJ-Application or EDJDemo with those secrets, run:

```bash
node automation/cpi-github.mjs doctor
```

It changes nothing. It reports whether each secret is set, whether the app's Agent API is reachable through the sign-in gate, whether the GitHub repository is reachable and writable, and whether the public-repository opt-in is in place. Fix anything marked `"ok": false`.

## 6. Recreate the automation

At cursor.com/automations in the new account:

| Field | Value |
| --- | --- |
| Name | Client requests → GitHub issues |
| Repository / branch | `niktunXSI/EDJ-Application` / `main` |
| Trigger | **Schedule** every 5 minutes (`*/5 * * * *`). Add a **Webhook** trigger as well only if the team has no IP allow list. |
| Tools | Turn off pull request creation |
| Run as | You |
| Prompt | The contents of `automation/PROMPT.md` |

## 7. Connect the app

In the new app, go to Integrations → Connection:

- **Schedule only:** keep the destination on **Built-in mock receiver**, turn on **Queue new submissions automatically**, and save.
- **With a webhook trigger:** choose **External webhook URL**, paste the automation's webhook URL, paste its key into Destination authorization token (just the key, no "Bearer"), turn on automatic queueing, save, then select **Send test event**. The delivery log shows the receiver's reason if it refuses.

## 8. Test

Submit a request. Within one schedule interval it should show **Completed** with an `EDJ-Application#N` link, and the issue should appear in EDJ-Application with the labels `client-request`, `priority: …`, `area: …` and `type: …`.

## 9. Clean up the old account (optional)

Once the new setup works, unpublish the old app and delete the old automation, so two automations aren't claiming from different apps.
