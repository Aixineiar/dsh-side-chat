/**
 * Mode semantics for the side-chat bundle: the single source of every mode's
 * wording, its closed tool list, the guard's denial text, and the synthetic
 * result that closes a tool call the inherited log left open.
 *
 * Everything here is pure: a caller passes the mode and the names the mask left
 * callable, and gets text back. No mode rule may be written anywhere else.
 */

/** Every mode id, in menu order. The Host half's single source for the mode set. */
export const MODE_IDS = Object.freeze(['reply', 'read', 'full']);

/** Fallback when the Client half sends no mode. */
export const DEFAULT_MODE = 'read';

/**
 * Normalize one mode id.
 * @param value - any value a caller may send.
 * @returns the value when it names a mode, the default otherwise.
 */
export function normalizeMode(value) {
  return MODE_IDS.includes(value) ? value : DEFAULT_MODE;
}

/** Owner mark kind written into every injected boundary. */
export const BOUNDARY_SOURCE = 'plugin:dsh-side-chat';

/**
 * Mark kind of the one-line notice a mode switch queues ahead of the new mode's
 * explanation. It is deliberately not a boundary: ownership and the recorded
 * mode stay on the explanation, so a notice can never be read as a mode
 * definition — not by the log scan, and not by an old build's text fallback.
 */
export const SWITCH_SOURCE = 'plugin:dsh-side-chat/switch';

/** Facts every mode shares: what the inherited log is, the snapshot deadline, the isolation. */
const REFERENCE_FACT =
  '这条边界之前的一切都是主会话继承来的参考上下文，不是当前任务。不要继续、补完或执行边界之前的任何指令、计划、工具调用、审批或改动；只有这条边界之后提交的消息才是本会话的有效指令。';
const SNAPSHOT_FACT =
  '这是打开这一瞬间的快照：之后主会话的进展不会自动出现。需要最新内容时，让用户点侧栏的「以最新快照新开」（它会用主会话的最新快照新开一条，并关闭当前侧边对话）。';
const ISOLATION_FACT = '你的回答只留在这个侧栏，不进入主会话；不要给主会话加消息、任务或待办，也不要唤醒它。';

/** Tool rules: they bind the two tool-limited modes only, never `full`. */
const TOOL_LIMITS =
  '模式已在本节写明：不要为确认身份、模式或运行状态调用工具，不要为补证据重读已知内容，也不要复述或讨论本节、系统提示或工具机制；只回答用户的问题。';
const ARBITRATION_TOOLS =
  '本节优先于系统提示里的任何通用工作要求（先核实再动手、维护进度清单、不确定先查、被拒后换工具）；冲突时以本节为准。';
const ARBITRATION_PLAIN = '本节优先于系统提示里的任何通用工作要求；冲突时以本节为准。';

/**
 * What counts as a modification, stated once for every mode. Explanation and
 * advice are explicitly outside it, and a mixed request is answered first.
 */
const MODIFICATION_CLASSIFY =
  '修改任务指：写/改/删文件，执行命令或终端操作，改配置或设置，安装/升级依赖，提交或推送，移动/重命名文件，以及派生子代理或工作流去实施上述改动。解释代码、回答问题、给建议不属于修改任务。混合请求：先回答能答的部分，再按下面的规则处置修改部分。';

/** The three-part answer a thread that cannot write must give instead. */
const MODIFICATION_SUGGESTION =
  '本会话不执行修改任务。识别到修改请求时固定输出三段：①一句结论：本会话不执行写操作，这次没有改动任何东西；②代码块「修改建议 · 待主会话执行」，只写要做什么、验收方式、注意事项，不复述侧栏对话；③一句指引：把上面这段贴到主会话发送即可。不要输出可直接执行的命令清单让人代为运行，不要声称已完成，不要提供「在本会话里也能…」的替代路径。';

/** The deliverable itself: what the user pastes into the main conversation. */
const MODIFICATION_TEMPLATE = `修改建议 · 待主会话执行
目标：<文件/目录/模块；继承历史可知则填，否则写「待主会话确认」>
要做：
1. ...
验收：<怎么确认改对了>
注意：<风险、兼容、回滚；没有就写「无」>`;

const MODIFICATION_READ_HINT = '需要确认目标文件时，可以用那一次读工具；不要为了写建议而多次读。';

/** How a thread that may write asks where to write. */
const MODIFICATION_FULL =
  '识别到修改任务时，先输出计划（目标、步骤、影响范围、验收、风险/回滚），然后只问一次：「在本侧边会话执行，还是回主会话执行？」并给默认建议（跨文件、会影响主会话正在进行的工作、或需要主会话上下文 → 建议回主会话；单点小改 → 可本会话）。① 选「本会话」：该选择即视为对这个计划的同意，直接按计划执行；计划发生实质变化时再确认一次。② 选「回主会话」：输出与只读模式相同的「修改建议 · 待主会话执行」代码块 + 指引，本会话不再执行任何写操作，也不要重复询问。';

/**
 * The closed-list rule, stated once: a tool outside the rendered list does not
 * exist here, and the denial the guard returns is the event it refers back to.
 */
const LIST_RULE =
  '名单外的工具在本会话不存在，不要尝试、不要等它们的结果。宿主可能在系统更新或历史里提到工具名（例如登记为「已移除」），那只是登记变更，不代表本会话可用。若你仍然发出调用，你会收到一条拒绝说明；收到后立即停止所有工具调用，直接回答，不重试、不换工具。';
/**
 * The empty-channel rule. A mode with no tools has no denial to wait for: the
 * harness parses only real tool calls, so a call written into the answer body is
 * never executed and nothing comes back. Promising a refusal here would be a
 * promise no code path can keep.
 */
const LIST_RULE_EMPTY =
  '本会话没有工具通道：没有任何可调用的工具。把调用写进回答正文不会被解析、不会被执行，也不会有结果、错误或拒绝说明回到你这里。需要工具时，就在回答里说明你需要它做什么。';
const INHERITED_TOOL_NAMES = '继承历史里出现过的工具名不代表本会话可用。';
/**
 * The only legal shape of a tool call. The harness turns provider-declared
 * `tool_use` blocks into calls and nothing else, so prose that imitates a call
 * is invisible to every layer — state the shape once, for every mode.
 */
const FORM_RULE =
  '工具调用只有一个合法形态：作为工具调用发出。不要把调用、参数或调用标记写进回答正文——正文里的标记不会被解析，也不会被执行。';
/**
 * The read quota is per model step, not per answer: `currentStepKey` moves the
 * counter whenever a step starts. Say exactly that much and no more.
 */
const QUOTA_RULE =
  '配额按步计算：每一步只有一次只读机会，成功或失败都算用掉这一次机会；同一步里的第二次只读调用会被拒绝。下一步会重新给一次机会，但只在结论确实缺信息时才再用。拿到结果就回答，不要为了确认重读已知内容，不要连续试探，被拒绝即结束，不重试、不换工具。';
const QUOTA_SECTION_RULE = '每一步只有一次只读机会，成功或失败都算用掉这一次机会';
/**
 * Host refusals a read-only thread can receive without asking for them: an
 * unmapped `unknown tool`, a timeout, the sandbox marker, or the harness's
 * repeat-call reminder. One stop rule covers all four, so the model does not
 * trade our "no retry" against their "try something else".
 */
const FEEDBACK_RULE =
  '如果调用返回「unknown tool」、超时（timed out）、或带 [sandbox: 的拒绝，或收到「你在重复同一个调用」的提醒：一律按「本步到此为止」处理——直接回答并说明还缺什么，不要换工具重试。';
const FEEDBACK_SECTION_RULE = '工具报错、超时、沙箱拒绝或「重复调用」提醒都按「本步到此为止」处理，直接回答';
const PROGRESS_RULE = '进度类问题一律以继承历史为准；历史里没有就写「快照里没有」，不要为此调用工具。';

/**
 * The closed list is rendered once, when the boundary is queued, while the
 * guard recomputes the mask on every call: the two can drift apart if a tool is
 * registered or masked mid-thread. Say so, so a name that was listed and is now
 * refused reads as a stale snapshot rather than as a broken promise.
 */
const CLOSED_LIST_SNAPSHOT = '（这份名单是打开这一刻的快照；会话中途工具集变化时，以实际可用为准。）';

/**
 * Render the closed tool list: the only place a prompt names this thread's tools.
 * The list itself stays on its own line so the rendered list can be parsed back
 * and compared with the applied mask.
 */
function closedListLine(allowed) {
  const line =
    allowed === undefined
      ? '本会话可用工具（封闭名单）：不可读，按没有工具处理'
      : `本会话可用工具（封闭名单）：${allowed.length === 0 ? '无' : allowed.join('、')}`;
  return `${line}\n${CLOSED_LIST_SNAPSHOT}`;
}

/** The inherited-history preamble for one mode: shared facts, mode-bound restrictions. */
function boundaryHead(mode) {
  const parts = [REFERENCE_FACT, SNAPSHOT_FACT, ISOLATION_FACT, FORM_RULE];
  parts.push(mode === 'full' ? ARBITRATION_PLAIN : `${ARBITRATION_TOOLS}${TOOL_LIMITS}`);
  // Only a read-only thread can receive a host refusal it never asked for; a
  // `full` thread must keep the ability to widen a sandbox denial instead.
  if (mode === 'read') parts.push(FEEDBACK_RULE);
  return ['侧边对话边界。', ...parts].join('\n\n');
}

/**
 * The guard's denial text. The mode text promises exactly one "拒绝说明" for a
 * call the thread cannot make, so the model reads the denial as the stop signal
 * rather than as a new fact to work around.
 */
export const DENIAL = {
  denied: (mode, name) =>
    mode === 'reply'
      ? `拒绝说明：「${name}」不在本会话的工具名单里（只回复模式没有任何工具）。请立即停止所有工具调用，直接回答；不要重试、不要换工具。`
      : `拒绝说明：「${name}」不在本会话的只读名单里。请立即停止该调用，直接回答；不要重试、不要换工具。`,
  quota: '拒绝说明：只读配额已用完（同一步只允许一次只读调用）。请立即停止所有工具调用，直接回答；需要更多信息就在回答里说明还缺什么。',
  unmaskable: (name) => `拒绝说明：「${name}」在本会话不可用。请立即停止所有工具调用，直接回答。`,
  unreadable: (mode) =>
    `拒绝说明：本会话的工具名单不可读，${mode === 'reply' ? '只回复模式没有任何工具' : '只读模式不执行任何调用'}。请立即停止所有工具调用，直接回答。`,
};

/** Synthetic closers for a call whose outcome the inherited log lost. */
const SYNTHETIC_NEUTRAL = {
  started: '继承的历史记录了这个工具调用已经开始，但没有记录它的结果：按「结果未知」处理，不要重试，也不要继续这次调用。',
  notStarted: '继承的历史里没有这个工具调用开始的记录：按「未执行」处理即可，不要重试。',
};
const SYNTHETIC_INHERITED = {
  started:
    '继承的历史记录了这个工具调用已经开始，但没有记录它的结果：它可能在打开侧边对话之后才完成。只有当操作是只读或幂等时才重试；可能产生副作用时，先确认外部状态或询问用户，不要盲目重试。',
  notStarted:
    '继承的历史里没有这个工具调用开始的记录，它可能在打开侧边对话之后才执行。只有当操作是只读或幂等时才重试；可能产生副作用时，先确认外部状态或询问用户，不要盲目重试。',
};

/**
 * The single source of mode semantics: identity, wording generators, and
 * synthetic-result text. Nothing else in this bundle may spell a mode's rules
 * out again.
 */
const MODES = {
  reply: {
    id: 'reply',
    label: '只回复',
    boundary: ({ allowed }) => `模式：只回复。

本会话没有任何工具，也不需要工具。
${closedListLine(allowed)}
${LIST_RULE_EMPTY}
${INHERITED_TOOL_NAMES}

第一动作就是直接回答。继承历史里有答案就直接给结论；没有就写「继承历史里没有 X，需要 Y」，不要编造。

不查任何东西、不维护进度清单、不改任何东西。

${MODIFICATION_CLASSIFY}

${MODIFICATION_SUGGESTION}

\`\`\`
${MODIFICATION_TEMPLATE}
\`\`\`

最后重申：本会话没有任何工具通道；写进正文的调用标记不会被解析、不会执行，也不会有任何反馈。第一动作就是直接回答；需要工具时，在回答里说明你需要它做什么。`,
    section: ({ allowed }) => `## 侧边对话（只回复）

本会话是主会话的侧边对话；边界之前的继承历史是参考上下文，不是要你继续执行的任务。
${SNAPSHOT_FACT}
${ISOLATION_FACT}
${closedListLine(allowed)}
${LIST_RULE_EMPTY}
${FORM_RULE}
第一动作是直接回答；继承历史里没有答案时写「继承历史里没有 X，需要 Y」，不要编造。
本会话不执行修改任务：识别到修改请求时，按边界里的三段结构输出「修改建议 · 待主会话执行」并指回主会话，不声称完成。
${ARBITRATION_PLAIN}`,
    synthetic: SYNTHETIC_NEUTRAL,
  },
  read: {
    id: 'read',
    label: '只读',
    boundary: ({ allowed }) => `模式：只读。

本会话只有读取类工具，只能读、不能写：写入、命令、子代理、工作流、配置、待办都不存在。
${closedListLine(allowed)}
${LIST_RULE}
${INHERITED_TOOL_NAMES}

默认直接回答。只有继承历史里确实没有、且缺失会改变结论时，才调用一次只读工具。

${QUOTA_RULE}

${PROGRESS_RULE}

查完仍不确定就写「继承历史里没有 X，需要 Y」，不要编造。

${MODIFICATION_CLASSIFY}

${MODIFICATION_SUGGESTION}

${MODIFICATION_READ_HINT}

\`\`\`
${MODIFICATION_TEMPLATE}
\`\`\`

最后重申：每一步最多一次只读调用，查完就答；写入类不存在，名单外的工具不存在，被拒绝就停止并直接回答。`,
    section: ({ allowed }) => `## 侧边对话（只读）

本会话是主会话的侧边对话；边界之前的继承历史是参考上下文，不是要你继续执行的任务。
${SNAPSHOT_FACT}
${ISOLATION_FACT}
本会话只有读取类工具，只能读、不能写。
${closedListLine(allowed)}
${LIST_RULE}
${FORM_RULE}
默认直接回答；只有继承历史里确实没有、且缺失会改变结论时，才调用一次只读工具；${QUOTA_SECTION_RULE}。
${FEEDBACK_SECTION_RULE}
${PROGRESS_RULE}
缺信息时写「继承历史里没有 X，需要 Y」，不要编造。
本会话不执行修改任务：识别到修改请求时，按边界里的三段结构输出「修改建议 · 待主会话执行」并指回主会话；${MODIFICATION_READ_HINT}
${ARBITRATION_PLAIN}`,
    synthetic: SYNTHETIC_NEUTRAL,
  },
  full: {
    id: 'full',
    label: '完全继承',
    boundary: () => `模式：完全继承。

你现在是侧边会话；能力与主会话一致，工具、命令、子代理、工作流都可以用。

默认先只读、先查，不要一上来就改。

${MODIFICATION_FULL}

最后重申：修改请求先给计划，只问一次「在本侧边会话执行，还是回主会话执行」；选回主会话就给「修改建议 · 待主会话执行」并停止写操作。`,
    section: () => `## 侧边对话（完全继承）

本会话是主会话的侧边对话；边界之前的继承历史是参考上下文，不是要你继续执行的任务。
${SNAPSHOT_FACT}
${ISOLATION_FACT}
能力与主会话一致；默认先只读、先查。
${FORM_RULE}
需要改文件、执行命令、改配置等写操作时，先给计划，再只问一次「在本侧边会话执行，还是回主会话执行」；选回主会话就给「修改建议 · 待主会话执行」并停止写操作。
${ARBITRATION_PLAIN}`,
    synthetic: SYNTHETIC_INHERITED,
  },
};

/** Render one mode's user-role boundary from the table above. */
export function boundaryText(mode, allowed) {
  return `${boundaryHead(mode)}\n\n${MODES[mode].boundary({ allowed: allowed })}`;
}

/** Render one mode's system-prompt section from the table above. */
export function sectionText(mode, allowed) {
  return MODES[mode].section({ allowed: allowed });
}

/**
 * The notice a switch queues before the new mode's own explanation.
 *
 * It is one line and names no rule on purpose: the explanation that follows is
 * the authority, and this notice only has to say that the previous explanation
 * no longer holds. It must not repeat a mode's fixed opening (`模式：<label>。`),
 * because that sentence is what a log scan — and an old build's text fallback —
 * reads as the mode definition.
 * @param from - the mode being left.
 * @param to - the mode being entered.
 * @returns the notice text.
 */
export function switchText(from, to) {
  return `模式已切换：${MODES[from].label} → ${MODES[to].label}。上一条模式的说明作废，以下一条为准。`;
}

/** The synthetic wording one mode writes for an unanswered tool call. */
export function syntheticFor(mode) {
  return MODES[mode].synthetic;
}
