import fs from 'fs';
let content = fs.readFileSync('engine/orchestrate.ts', 'utf-8');

const newToolsDoc = `- **delegate_to_cli(prompt)** — Hand the story to the CLI engineer with a complete brief. The tool streams the session and returns a structured delivery report.
- **intervene(reason, new_instructions)** — The CLI got stuck or failed. Re-brief with corrected direction.
- **create_fix_task(issue, fix_instructions)** — When a story fails, create a targeted fix task and re-queue it.
- **create_qa_task(scope, test_instructions)** — After an epic completes, queue a QA task.
- **mark_story_done(summary)** — Delivery accepted. Call this ONLY after verifying via spot_check_code or run_verification.
- **mark_story_failed(reason)** — Last resort escalation.
- **ask_developer(question)** — Suspend the build and ask the human for clarification on business logic.
- **split_story(original_slug, new_stories)** — Decompose a complex story that the CLI cannot handle into smaller phased feature stories.
- **update_story_yaml(slug, yaml_content)** — Amend a story's requirements or stack choices.
- **read_queue()** — Check the task queue to see upcoming dependencies.
- **run_verification(command)** — Independently run build scripts (npm run build) or tests to verify CLI code.
- **spot_check_code(filepath)** — Read a specific file to verify the CLI actually implemented the acceptance criteria.
- **write_adr(title, decision, consequences)** — Explicitly document new architectural decisions and stack changes in .factory/knowledge/.
- **update_project_state(key, value)** — Manage the living project state (e.g. milestones) in .factory/logs/state.yaml.`;

content = content.replace(
    /- \*\*delegate_to_cli\(prompt\)\*\*[\s\S]*?- \*\*update_context\(message\)\*\*[\s\S]*?\n/m, 
    newToolsDoc + '\n'
);

fs.writeFileSync('engine/orchestrate.ts', content);
