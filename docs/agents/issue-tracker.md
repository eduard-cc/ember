# Issue tracker: Linear

Issues and specs for Ember live in the Linear project named **Ember**, using the Linear tools. GitHub Issues are disabled on this repository, so never call `gh issue`.

## Conventions

- **Create an issue**: `save_issue` with the Ember project and its team; check `list_issues` for a duplicate first.
- **Read an issue**: `get_issue`, plus `list_comments` for the discussion.
- **List issues**: `list_issues` filtered by the Ember project, label and status.
- **Sub-issue**: set the parent on `save_issue`.
- **Blocking**: Linear's blocked-by relation on `save_issue`. An issue is startable when every blocker is done or cancelled.
- **Comment**: `save_comment`.
- **Labels**: pass the full label list to `save_issue`; it replaces the existing labels.
- **Close**: comment with the reason, then move the issue to a done or cancelled status.

Issues, comments and titles follow the same privacy rules as the repository: no personal training data.

## When a skill says "publish to the issue tracker"

Create a Linear issue in the Ember project.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.
