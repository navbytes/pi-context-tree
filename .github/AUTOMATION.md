# Repository automation

All code changes go through pull requests. Draft PRs skip expensive CI; mark a PR ready to validate its latest revision. Superseded PR runs cancel. Documentation-only changes skip product checks; no paid runner waits or duplicate main-branch validation.

Prepare a release by opening a PR with the version bump and release notes. A manual merge or an explicit instruction to a local agent to release authorizes publication after all required checks pass. “Prepare a release” stops at the PR. Never bypass checks or automatically merge dependency or release PRs. Repositories without a publishing destination do not need artificial releases.

Routine dependencies are grouped weekly; security updates remain immediate. Production schedules and existing external publishing approval gates remain in force.

For a release, use local gh to open a PR that bumps the package and workspace versions together, updates the lockfile, and adds the matching CHANGELOG section. Merge after Required CI passes. The merged version manifest triggers the GitHub release and explicitly dispatches the existing npm publisher on the new tag (GITHUB_TOKEN-created release events do not trigger workflows). No tags need to be pushed manually. The npm publisher retains its existing credentials/OIDC configuration.
