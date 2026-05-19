#!/bin/bash
# Task Manager - manage tasks in todo.toon (single source of truth)
# Usage: manage.sh <command> [options]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TASKS_FILE="${TASKS_FILE:-$SCRIPT_DIR/todo.toon}"

BLUE=$(printf '\033[0;34m')
GREEN=$(printf '\033[0;32m')
YELLOW=$(printf '\033[1;33m')
RED=$(printf '\033[0;31m')
NC=$(printf '\033[0m')

show_help() {
  cat <<EOF
Task Manager - manage task lifecycle

Usage: manage.sh <command> [options]

Commands:
  list                      Show all tasks (todo/in_progress/next/completed)
  list --status <s>         Filter by status (todo|in_progress|completed|next)
  add <summary>             Add a task (positional). Options:
    --priority <p>          Priority: 1(critical)|2(high)|3(medium)|4(low)|5(lowest)
    --component <c>         Component path
    --depends <id>          Task dependency ID
  start <task_id>           Claim a task — move from next/todo to in_progress
  complete --id <id>        Mark task done — move from in_progress to completed
    --summary <text>        Completion summary (optional)
  status <task_id>          Show detailed status of a single task
  update --id <id>          Update task fields:
    --status <s>            New section: next|in_progress|completed|cancelled
    --priority <p>          New priority 1-5
    --summary <text>        New summary
  --help                    This help

Exit Codes:
  0 — Success
  1 — Invalid command or missing arguments
  2 — Task not found
  3 — TOON parse error
EOF
}

task_exists() {
  grep -q "^    - ${1}:" "$TASKS_FILE" 2>/dev/null
}

get_task_section() {
  local id="$1"
  awk -v id="$id" '
    /^  [a-z_]+:$/ { section = $1; gsub(/:/,"",section) }
    /^    - / && index($0, id) > 0 { print section; exit }
  ' "$TASKS_FILE"
}

list_tasks() {
  local filter="$1"
  echo ""
  echo "=== Task Status ==="
  echo ""

  for section in "next" "in_progress" "completed" "cancelled"; do
    local label=""
    case "$section" in
      next) label="NEXT / TODO" ;;
      in_progress) label="IN PROGRESS" ;;
      completed) label="COMPLETED" ;;
      cancelled) label="CANCELLED" ;;
    esac

    [[ -n "$filter" && "$filter" != "$section" ]] && continue

    echo "--- $label ---"
    local count=0

    while IFS='|' read -r id summary; do
      [[ -z "$id" ]] && continue
      printf "  * %b%s%b\n" "$BLUE" "$id" "$NC"
      echo "    Summary: $summary"
      count=$((count + 1))
    done < <(awk -v sec="$section" '
      /^  [a-z_]+:$/ {
        split($1, parts, ":")
        if (parts[1] == sec) in_sec = 1
        else if (in_sec) in_sec = 0
      }
      in_sec && /^    - / {
        split($0, a, ": ")
        id = substr(a[1], 7)
        summary = (a[2] ? a[2] : "No summary")
        printf "%s|%s\n", id, summary
      }
    ' "$TASKS_FILE" 2>/dev/null || echo "")

    [[ $count -eq 0 ]] && echo "  (empty)"
    echo ""
  done
  echo "Source: $(basename "$TASKS_FILE")"
}

show_status() {
  local task_id="$1"
  echo ""
  echo "=== Task Status: $task_id ==="
  echo ""

  local section=$(get_task_section "$task_id")
  if [[ -z "$section" ]]; then
    echo "  (no task found with id: $task_id)"
    return
  fi

  echo "Section: $section"

  awk -v id="$task_id" '
    /^    - / && index($0, id) > 0 { found = 1; print "  ID: " id; next }
    found && /^        [a-z_]+:/ {
      gsub(/^        /, "")
      gsub(/:$/, "")
      gsub(/: "/, ": ")
      gsub(/"$/, "")
      print "  " $0
    }
    found && /^    - / { exit }
  ' "$TASKS_FILE"
}

add_task() {
  local summary="" priority="" component="" depends=""

  [[ $# -gt 0 && "$1" != -* ]] && summary="$1" && shift

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --priority) priority="$2"; shift 2 ;;
      --component) component="$2"; shift 2 ;;
      --depends) depends="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  [[ -z "$summary" ]] && { echo "Error: summary required" >&2; exit 1; }

  local task_id
  task_id=$(echo "$summary" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_]/_/g' | sed 's/__*/_/g' | sed 's/^_//;s/_$//' | cut -c1-50)

  local suffix=1
  while task_exists "${task_id}_${suffix}" 2>/dev/null; do suffix=$((suffix+1)); done
  task_exists "$task_id" && task_id="${task_id}_${suffix}"

  if grep -q "^  next:" "$TASKS_FILE"; then
    sed -i '' "/^  next:/a\\
    - ${task_id}:\\
        status: todo\\
        priority: ${priority:-3}\\
        summary: \"${summary}\"" "$TASKS_FILE"
  else
    sed -i '' "/^tasks:/a\\
  next:
    - ${task_id}:
        status: todo
        priority: ${priority:-3}
        summary: \"${summary}\"" "$TASKS_FILE"
  fi

  printf "%bTask added: %b%s%b\n" "$GREEN" "$BLUE" "$task_id" "$NC"
  echo "Summary: $summary"
  echo "Priority: ${priority:-3}"
  [[ -n "$component" ]] && echo "Component: $component"
  [[ -n "$depends" ]] && echo "Depends on: $depends"
}

start_task() {
  local task_id="$1"
  [[ -z "$task_id" ]] && { echo "Error: task_id required" >&2; exit 1; }

  local section=$(get_task_section "$task_id")
  [[ -z "$section" ]] && { echo "Error: task '$task_id' not found" >&2; exit 2; }

  if [[ "$section" == "next" ]]; then
    local line_num summary=""
    line_num=$(awk -v id="$task_id" '
      /^    - / && index($0, id) > 0 { print NR; exit }
    ' "$TASKS_FILE")
    [[ -z "$line_num" ]] && { echo "Error: could not locate task in file" >&2; exit 2; }

    summary=$(awk -v id="$task_id" '
      /^    - / && index($0, id) > 0 { found=1; next }
      found && /summary:/ { gsub(/^[ \t]*summary: "/, ""); gsub(/"$/, ""); print; exit }
    ' "$TASKS_FILE")

    # Remove the task line
    sed -i '' "${line_num}d" "$TASKS_FILE"

    # Add to in_progress section
    sed -i '' "/^  in_progress:/a\\
    - ${task_id}:\\
        status: in_progress\\
        priority: high\\
        summary: \"${summary:-Working on ${task_id}}\"" "$TASKS_FILE"

    printf "%bTask started: %b%s%b\n" "$GREEN" "$BLUE" "$task_id" "$NC"
    echo "Status: in_progress"
    echo "Summary: ${summary:-Working on $task_id}"
  elif [[ "$section" == "in_progress" ]]; then
    echo "Task '$task_id' is already in_progress"
  else
    echo "Task '$task_id' is in section '$section' — can only start tasks from 'next' or 'todo'"
  fi
}

complete_task() {
  local task_id="" summary=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) task_id="$2"; shift 2 ;;
      --summary) summary="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  [[ -z "$task_id" ]] && { echo "Error: --id required" >&2; exit 1; }

  local section=$(get_task_section "$task_id")
  [[ -z "$section" ]] && { echo "Error: task '$task_id' not found" >&2; exit 2; }

  if [[ "$section" == "in_progress" ]]; then
    local line_num
    line_num=$(awk -v id="$task_id" '
      /^    - / && index($0, id) > 0 { print NR; exit }
    ' "$TASKS_FILE")
    [[ -z "$line_num" ]] && { echo "Error: could not locate task in file" >&2; exit 2; }

    [[ -z "$summary" ]] && {
      summary=$(awk -v id="$task_id" '
        /^    - / && index($0, id) > 0 { f=1; next }
        f && /summary:/ { gsub(/^[ \t]*summary: "/, ""); gsub(/"$/, ""); print; exit }
      ' "$TASKS_FILE")
    }
    [[ -z "$summary" ]] && summary="Completed $task_id"

    # Remove the task block
    sed -i '' "${line_num}d" "$TASKS_FILE"

    # Add to completed section
    sed -i '' "/^  completed:/a\\
    - ${task_id}:\\
        summary: \"${summary}\"" "$TASKS_FILE"

    printf "%bTask completed: %b%s%b\n" "$GREEN" "$BLUE" "$task_id" "$NC"
    echo "Summary: $summary"
  elif [[ "$section" == "completed" ]]; then
    echo "Task '$task_id' is already completed"
  else
    echo "Task '$task_id' is in section '$section' — can only complete tasks from 'in_progress'"
  fi
}

update_task() {
  local task_id="" new_section="" new_priority="" new_summary=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) task_id="$2"; shift 2 ;;
      --status) new_section="$2"; shift 2 ;;
      --priority) new_priority="$2"; shift 2 ;;
      --summary) new_summary="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  [[ -z "$task_id" ]] && { echo "Error: --id required" >&2; exit 1; }

  local section=$(get_task_section "$task_id")
  [[ -z "$section" ]] && { echo "Error: task '$task_id' not found" >&2; exit 2; }

  [[ -n "$new_priority" ]] && {
    sed -i '' "/^    - ${task_id}:/,/^    - /s/priority:.*/priority: ${new_priority}/" "$TASKS_FILE"
  }
  [[ -n "$new_summary" ]] && {
    sed -i '' "/^    - ${task_id}:/,/^    - /s/summary: \"[^\"]*\"/summary: \"${new_summary}\"/" "$TASKS_FILE"
  }
  [[ -n "$new_section" ]] && {
    echo "Section moves: use 'start' or 'complete' commands instead"
  }

  printf "%bTask updated: %b%s%b\n" "$GREEN" "$BLUE" "$task_id" "$NC"
  [[ -n "$new_section" ]] && echo "Status: $new_section"
  [[ -n "$new_priority" ]] && echo "Priority: $new_priority"
  [[ -n "$new_summary" ]] && echo "Summary: $new_summary"
}

main() {
  [[ $# -eq 0 || "$1" == "--help" ]] && show_help

  local cmd="$1"
  shift

  case "$cmd" in
    list)
      local filter=""
      [[ $# -gt 0 && "$1" == "--status" ]] && { shift; filter="$1"; }
      list_tasks "$filter"
      ;;
    add) add_task "$@" ;;
    start) start_task "$1" ;;
    complete) complete_task "$@" ;;
    status) show_status "$1" ;;
    update) update_task "$@" ;;
    *)
      echo "Unknown command: $cmd" >&2
      show_help
      exit 1
      ;;
  esac
}

main "$@"
