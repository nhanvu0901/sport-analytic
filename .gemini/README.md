# .gemini/settings.json

`settings.json` here only names the auth METHOD (`security.auth.selectedType:
"gemini-api-key"`) — it holds no key, and never should. JSON cannot carry a
comment, so the two instructions that would otherwise be one live here
instead:

- Set the `GEMINI_API_KEY` environment variable (e.g. in your shell profile)
  to actually authenticate with that method — do not put the key in this
  directory.
- Alternatively, run `gemini` interactively once and follow its own
  authentication prompt (e.g. "Login with Google"), which writes its own
  credentials outside this repo.
