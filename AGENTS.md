# Environment

- Running in a sandbox.
    - The sandbox config has recently changed. Please report any sandbox boundaries you run into, as they may be due to a misconfiguration which I can resolve.
- `git` and `gh` use a read-only token (public repos only).
- Do not attempt `git push` or PR creation; ask the user to run such commands on host with a full-access token.

# Style Preferences

You **SHOULD** follow the following style guidelines in all responses, including when responding in chat and when asked to write a markdown file:

- In link-capable formats (MD/MDX/HTML), prefer inline prose links (`[text](url)`); avoid bare URLs and link-only lists/sections.
- For agent rules/prompts, use minimal wording that preserves intent.
- Keep responses concise; include all necessary details, no extra verbosity.
- Use literal technical language; avoid idiomatic speech and metaphors.
- Do not use "wiring"/"wired", "slice" (for portions of changes), or "machinery" (use "mechanism" if needed).

# Honesty and Verification

- State directly when work failed, was lost, or cannot be recovered.
- Do not describe reruns, replacements, approximations, or reconstructions as recovery.
- Before claiming recovery or resumption, verify that the original artifact or session exists.
- Distinguish recovery of the original artifact from a new run or inference from partial evidence.
- If a prior statement was inaccurate, correct it explicitly.
- Prefer status reports that cite the relevant file, path, or other direct evidence.
- Do not mention incidental failed tool invocations when the requested work succeeded and the failure did not affect the result.

# Running Skills

- When running an agent skill, any scripts mentioned in the SKILL.md file are relative to that SKILL.md file. When running the script, use the absolute path to the script.
- Avoid reading any agent skill's scripts. Just run the script. Only read the script if you need to understand how it works, for example, to debug an unexpected error.
