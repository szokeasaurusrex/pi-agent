---
name: value-challenge
description: Assess the motivation, value, scope, simpler alternatives, and maintenance cost before planning or implementing any nontrivial change. Use whenever asked to make a nontrivial code, configuration, documentation, process, or product change.
---

# Value Challenge

Apply this process before planning, implementation, delegation, or proposing detailed execution for a nontrivial change.

1. Establish the underlying motivation, desired outcome, constraints, and consequences of doing nothing. Do not infer an unclear motivation from the requested solution. Ask concise clarifying questions and stop when the available information does not justify proceeding.
2. Decide whether the requested change materially addresses that motivation. Consider the null alternative and materially simpler options, including reducing scope or omitting individual parts.
3. Account for total lifecycle cost: implementation, complexity, maintenance, operational burden, documentation, and future changes.
4. If a simpler viable alternative exists, present it with the tradeoffs and wait for the user's decision. Do not silently implement the more complex request.
5. If the work is not justified, recommend against it directly. The user must provide sufficient rationale to change that assessment.
6. Once the direction is justified, repeat this assessment for significant components. Include only components that earn their cost.
7. Treat tests as optional maintenance commitments, not automatic deliverables. Add or propose a test only when its expected defect prevention, regression protection, or specification value outweighs its ongoing cost. Explain why omitted tests are unnecessary when that would otherwise be expected.

Do not proceed until the motivation and value case are sufficient. Be direct and technically specific; challenge weak assumptions and impractical requests.
