# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 2.0.x | ✅ |
| 1.9.x | ✅ (maintenance) |
| 1.8.x | ✅ (maintenance) |
| < 1.8 | ❌ (upgrade to the latest release) |

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report privately via
[GitHub Security Advisories](https://github.com/xmutfyh/dsh-plugin-writing-guard/security/advisories/new)
or open a private issue.

Include:

- the plugin version and DSH version you are using
- a minimal reproducer (config + document text)
- the impact you observed

You should receive an acknowledgment within 3 business days; fixes land in a patch release, and
the issue is disclosed after the fix is out.

## Security notes for this plugin

- Deterministic integrity checks run locally. Semantic style decisions are performed by the host model using Writing Guard policy instructions; the plugin does not make a separate model/API call for those decisions.
- The plugin only **reads** paper files that the agent just wrote/edited (paths the agent itself
  provided) and writes its incremental state file under `~/.dsh/plugins/dsh-plugin-writing-guard/`.
- Manuscript privacy therefore also depends on the privacy and data-handling settings of the host model/runtime in which Writing Guard is used.
- If you install this plugin from an untrusted source, the DSH host grants it the same privileges
  as any other third-party plugin — review the code or install only from this repository / npm.
