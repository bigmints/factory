* **[2026-05-23]**
  * **Action**: Created
  * **What**: Issues column on board
  * **Because**: Needed dynamic display for desktop and mobile
  * **So that**: Board shows Issues column on larger screens, hides on mobile, and adjusts column count

* **[2026-05-23]**
  * **Action**: Changed
  * **What**: Mobile carousel dot indicator and column layout
  * **Because**: Needed to integrate new Issues column without breaking mobile experience
  * **So that**: Mobile carousel dot indicator automatically includes new column, and column count varies (5 with Issues, 4 otherwise)

* **[2026-05-23]**
  * **Action**: Fixed
  * **What**: Board – unsynced stories handling and Issues column removal
  * **Because**: Unsynced stories were not going into Backlog correctly and Issues column needed to be removed
  * **So that**: Unsynced stories correctly appear in Backlog, and Issues column is no longer shown

* **[2026-05-23]**
  * **Action**: Changed
  * **What**: spec-bootstrap skill
  * **Because**: Needed to simplify story structure – eliminate epics and dependsOn, use flat stories
  * **So that**: Skill generates simpler, more straightforward story specs

* **[2026-05-23]**
  * **Action**: Created
  * **What**: app-context skill
  * **Because**: Needed ability to scan existing projects and provide context
  * **So that**: Other skills can leverage existing project structure and files

* **[2026-05-23]**
  * **Action**: Changed
  * **What**: app.yaml → scaffold.yaml throughout
  * **Because**: "app.yaml" sounded like a build artifact, not a planning spec
  * **So that**: Clarifies that scaffold.yaml describes what to build, not what was built

* **[2026-06-17]**
  * **Action**: Created
  * **What**: Node.js TypeScript project validation
  * **Because**: Needed to verify and build a simple "hello world" project with correct tooling
  * **So that**: Project compiles, runs, and passes lint without errors
