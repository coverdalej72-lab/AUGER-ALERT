#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: "Browser-based Farm Feed Withdrawal Timer. Latest work: (1) reliable night-time browser Web Push alarms so a paired phone rings even when locked, delivered only to the manager on catch; (2) ability to upload the catch sheet from the phone browser (managers get the sheet by email)."

backend:
  - task: "Web push subscription lifecycle (subscribe/status/test/unsubscribe)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "New endpoints: POST /api/push/subscribe, GET /api/push/status, POST /api/push/test, DELETE /api/push/subscribe/{device_id}, GET /api/push/vapid-public. Stored in db.push_subscriptions keyed by endpoint. VAPID keys in backend/.env. Real delivery to a live push service cannot be verified from a headless client; verify endpoints return correct shapes and that /push/test returns ok even when the endpoint is unreachable (send failure is caught/logged, 404/410 prune the sub)."
  - task: "Scheduled push delivery gated to assigned manager"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "APScheduler job deliver_due_alarms runs every 15s. Only pushes to the device_id of the recipient assigned to the active schedule, for pending alarms whose fire_at_utc<=now, with re-alert on realert_interval up to realert_max. Verify no crash on startup and that gating logic (no assigned manager => no push) holds."
  - task: "Regression: upload / manual schedule / delay / assign / active-alarms gating still work"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "server.py changed (imports, make_alarms now preserves push_count/last_pushed_at). Confirm existing flows unaffected. Local pytest: 24 passed."

frontend:
  - task: "Phone push opt-in card + service worker + PWA manifest"
    implemented: true
    working: "NA"
    file: "frontend/src/components/PushOptIn.tsx, frontend/src/utils/push.ts, frontend/public/sw.js, frontend/public/manifest.json"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Push opt-in card on phone Home + Settings (web only). /sw.js, /manifest.json, /icon-192.png confirmed 200 at root. Headless browsers report Notification.permission=denied so the card correctly shows the 'blocked/open settings' state — that is expected, not a bug. Just confirm the card renders and the app isn't broken."
  - task: "Upload catch sheet from the phone"
    implemented: true
    working: "NA"
    file: "frontend/app/(tabs)/home.tsx, frontend/src/utils/upload.ts"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Upload button in Home header + empty-state uses expo-document-picker -> POST /api/upload. Confirm button renders; file-picker itself can't be driven in automation."

metadata:
  created_by: "main_agent"
  version: "2.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "Web push subscription lifecycle (subscribe/status/test/unsubscribe)"
    - "Scheduled push delivery gated to assigned manager"
    - "Regression: upload / manual schedule / delay / assign / active-alarms gating still work"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: "Added browser Web Push (backend delivery via APScheduler + subscribe/test endpoints, VAPID configured) and phone-side catch-sheet upload. Please test BACKEND thoroughly: push endpoint lifecycle, that /push/test does not 500 on an unreachable endpoint, scheduler gating, and regression of upload/manual/delay/assign/active-alarms. Real push delivery to a live browser cannot be verified here — focus on endpoint correctness + no regressions. Frontend: just a light smoke check that the phone Home/Settings render with the push card + Upload button (headless shows the 'blocked' push state, which is expected)."
    -agent: "main"
    -message: "NEW: Added a Stripe SEASON PASS paywall (Emergent-managed Stripe, one-time AUD $29, unlocks 365 days). The desktop /dashboard is now gated. Endpoints: GET /api/billing/plan, POST /api/payments/checkout {email,product,origin}, GET /api/payments/status/{session_id}, GET /api/season-pass/status?email=. A demo pass is seeded for demo@feedwithdrawal.app (see test_credentials.md). Please TEST BACKEND billing: (1) /billing/plan returns AUD 29; (2) checkout returns a real Stripe url+session_id (proxy) and inserts a payment_transactions row as 'unpaid'; (3) amount is server-fixed — a client sending a different amount is ignored (only email/product/origin are read); (4) /season-pass/status returns active:true for demo@feedwithdrawal.app and active:false for unknown; (5) status/{unknown_session} => 404; (6) fulfillment is idempotent (cannot double-grant) — you can't complete a real hosted checkout headlessly, so verify the find_one_and_update claim logic by seeding a payment_transactions doc with payment_status stays as returned by Stripe (a fresh unpaid session should return fulfilled:false). Also REGRESSION: push endpoints + upload/manual/delay/assign/active-alarms still work. Frontend already verified by main agent via screenshot: paywall renders (A$29) and entering demo@feedwithdrawal.app + 'check access' unlocks the full control centre. NOTE: a global AlarmOverlay can cover the paywall if a due-alarm active schedule exists — known minor edge case, not a billing bug."

billing_backend:
  - task: "Stripe season pass — checkout, status/fulfillment, pass gating"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Emergent-managed Stripe (sk_test_emergent via proxy), one-time AUD $29 unlocks 365 days. Amount fixed server-side in PRICE_MAP. Verified locally: /billing/plan=AUD29, checkout returns real cs_test url (proxy 200), season-pass status active for seeded demo email. Needs: idempotent-fulfillment check, tamper resistance (client amount ignored), 404 on unknown session, regression of push+schedule flows."
