# AI AGENT RULES

1. **Read CALLFLOW_PROJECT_CONTEXT.md first.** Understand the big picture.
2. **Read MVP1_BUILD_SPEC_v5.md before major changes.** It is the source of truth for the product scope.
3. **Inspect existing code before changing it.** Do not blindly replace working files.
4. **Never invent APIs.** Do not hallucinate SDK methods or provider endpoints.
5. **Verify official provider documentation when required.**
6. **Never expose secrets.** Do not commit API keys, secrets, or passwords.
7. **Preserve verified functionality.** Do not break what works.
8. **Do not rewrite working architecture without authorization.**
9. **Respect stage scope.** Stop when the task is complete.
10. **Run tests after changes.**
11. **Report failures honestly.** Do not fake test results.
12. **Do not claim unverified behavior.** If a real provider wasn't tested, say so.
13. **Do not modify unrelated modules.** Stick to the task.
14. **Keep tenant isolation intact.** Always verify workspace_id.
15. **Preserve webhook idempotency.**
16. **Preserve provider abstraction.** Do not leak Telnyx logic into core routing.
17. **Do not introduce out-of-scope MVP features.**
18. **Stop when the requested stage is complete.**
