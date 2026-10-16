"""模型审查：把 software-design review 准备的材料交给 jev（omp 的 judge），找出程序判不了的反模式。

在 omp 的 eval（Python）里使用：

    %load skill://software-design/scripts/review.py
    findings = await review("/path/to/repo/design")

问题的措辞与阈值用 review-calibration.json 里的正反样本校准过；改动措辞或阈值之后运行
`await calibrate()`，每个问题都要零误判才算校准通过。
judge 只在 omp 的 eval 里存在，所以这一步不在 software-design check 里。
"""

import json
import shutil
import subprocess
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent if "__file__" in globals() else Path("~/.agents/skills/software-design").expanduser()

# 每个问题：判断说明、阈值（P(yes) 不低于它就算反模式）、给作者的修改说明。
QUESTIONS = {
    "stringly": (
        "The state is one element of a VDM-SL design spec whose type is a character string (seq of char), with the comment of the "
        "definition it belongs to. Answer yes if the string stands for something that should be its own type: an identity, a closed "
        "set of alternatives (states, kinds, roles, results), or structured data. Answer no if it is genuinely free-form text that "
        "the system passes through or shows to people without interpreting it.",
        0.5,
        "这里用字符串代表身份、状态、种类或结构：给它一个类型（token、quote 并类型或记录）。",
    ),
    "bool_stack": (
        "The state is a VDM-SL record or state definition with boolean fields. Answer yes if several booleans together encode "
        "mutually exclusive phases or states of one thing (so only some combinations are meaningful and a single union of quote "
        "values should replace them). Answer no if each boolean is an independent option that can be freely combined.",
        0.5,
        "几个 bool 字段一起表示互斥的状态：改成一个 quote 并类型。",
    ),
    "reasons": (
        "The state is a VDM-SL union of quote values (with its comment). Some unions list kinds of things that are genuinely "
        "different (phases, modes, channels, outcomes that need different handling). Others list many detailed causes of the same "
        "failure (quota, auth, busy, bad input...), which is boundary-case enumeration a design should collapse into one failure "
        "branch. Answer yes if this union lists detailed causes of failure or rejection. Answer no if its branches are genuinely "
        "different kinds, phases, modes or outcomes.",
        0.4,
        "结局逐项列出了失败或拒绝的原因：合成一支，原因不写进设计。",
    ),
    "comment_shape": (
        "The state is a definition from a VDM-SL design spec and the comment written for it. Answer yes if the comment only "
        "restates the shape or type structure that the definition already shows (field names, types, parameter and result types) "
        "without saying what the element means or promises. Answer no if the comment states meaning, a promise, or a rule not "
        "visible in the type structure.",
        0.5,
        "说明只复述了形状：写它是什么、承诺什么。",
    ),
    "impl_body": (
        "The state is one definition with an explicit body from a VDM-SL design document. In a design, explicit bodies are allowed "
        "only for scenarios (calling connections in order) and for decisions whose result two independent implementations must "
        "agree on. Answer yes if this body instead describes how to implement something: assigning state, loops, caches, eviction, "
        "generating ids, data-structure manipulation. Answer no if it is a scenario or a decision.",
        0.5,
        "显式体描述的是怎样实现：改成隐式定义的 post。",
    ),
    "registry": (
        "The state is one VDM-SL module from a design document. Answer yes if the module is only a registry of names: its types and "
        "operations carry no structure, invariants, pre/postconditions or relations, so it promises nothing that a reader or checker "
        "could verify. Answer no if it specifies structure, invariants, outcomes or pre/postconditions.",
        0.5,
        "模块只登记了名字，没有结构、不变式或 pre/post：写出它承诺什么，否则不写这个模块。",
    ),
    "simulation": (
        "The state is a VDM-SL module from a design document. Answer yes if the module simulates runtime machinery such as a clock "
        "that ticks, processes that crash or restart, threads, or scheduling, instead of specifying the system's data, connections "
        "and invariants. Answer no otherwise.",
        0.5,
        "模块在模拟运行机制（时钟、进程、调度）：这些写进「语义」，不建模。",
    ),
    "business_in_arch": (
        "The state has one `definition` from an architecture-level VDM-SL module and the list of `business_units` that are built on "
        "top of the architecture. Answer yes if this definition (or a branch, field or parameter inside it) exists only to serve one "
        "specific business unit and would be meaningless to the others. Answer no if it is generic infrastructure meaningful to any "
        "business unit.",
        0.4,
        "架构里有只为某个业务单元存在的定义或分支：移到业务单元。",
    ),
    "prose_restates": (
        "The state has a formal VDM-SL module `spec` and one `paragraph` of prose. Answer yes only if everything the paragraph says "
        "can already be read off the spec: signatures, fields, union branches, or what a pre/postcondition or invariant already "
        "states. Answer no if the paragraph says anything the spec does not contain, such as timing, transactions, processes, "
        "crashes, versions, people, reasons or sources.",
        0.5,
        "这段文字只复述了规格：删掉，或改写成规格说不清的语义。",
    ),
    "coined": (
        "The state has `spec_names`, the complete vocabulary of a design spec, and one `paragraph` of design prose. Does the "
        "paragraph name some thing — a component, role, actor, state, phase, artifact, lock, queue or mechanism — that has no "
        "counterpart in `spec_names`? Ordinary words, numbers, units, time expressions and generic words such as 'process', "
        "'caller', 'system' do not count. Answer yes only if such an invented named thing appears.",
        0.45,
        "这段文字用了规格里没有的名字：把它写成规格元素，或改用已有的名字。",
    ),
    "basis": (
        "The state is one paragraph from the 'basis' (依据) section of a design document. A proper basis states an external fact, "
        "constraint or requirement, names its source, and says what it changes in the design ('所以…'). Answer yes if the paragraph "
        "is NOT a proper basis: it has no source, or it is a bare wish, or it cites the current implementation or a technology "
        "choice as the reason. Answer no if it is a proper basis.",
        0.5,
        "这条依据没有来源，或拿实现与技术选型当理由：写出外部事实、来源与“所以”。",
    ),
    "figure_code": (
        "The state is one `block` placed in a design document's figure code block (```mermaid, ```ebnf or ```text), which is "
        "reserved for diagrams (Mermaid, ASCII art) and grammars (EBNF/BNF). Answer yes if the block is instead source code in any "
        "programming language: type, struct, enum, class, interface or trait declarations, function signatures, or function bodies. "
        "Answer no if it is a diagram or a grammar.",
        0.5,
        "图与文法块里是代码：类型、接口与签名写成 ```vdm 规格；实现放进 appendix/reference/。",
    ),
}


def materials(design: str) -> list[dict]:
    """用本 skill 自己的 design.ts 取审查材料：材料与校准来自同一份脚本，不看 PATH 上装的是哪一份。"""
    script = SKILL / "scripts" / "design.ts"
    if not script.exists():
        raise RuntimeError(f"找不到 {script}：review.py 与 scripts/design.ts 要在同一个 skill 目录里。")
    bun = shutil.which("bun")
    if bun is None:
        raise RuntimeError("PATH 上没有 bun：先按本 skill 的 references/setup.md 安装。")
    run = subprocess.run(
        [bun, str(script), "review", design],
        capture_output=True,
        text=True,
    )
    if run.returncode != 0:
        raise RuntimeError(f"{script} review 失败：\n{run.stdout}{run.stderr}")
    return json.loads(run.stdout)["items"]


async def _probabilities(question: str, states: list) -> list[float]:
    """对一组判断对象问同一个问题，按顺序返回每个对象的 P(yes)。"""
    instructions = QUESTIONS[question][0]
    batch = judge_batch(
        {str(i): state for i, state in enumerate(states)},
        {"q": {"type": "bool", "instructions": instructions}},
        intent=f"审查 {question}",
    )
    answered: dict[str, float] = {}
    failed: dict[str, str] = {}
    while len(answered) + len(failed) < len(states):
        for key, result in await batch.drain(120):
            if result.answers:
                answered[key] = result.answers["q"]["bool"]
            else:
                failed[key] = str(result.error)
    batch.close()
    if failed:
        raise RuntimeError(f"{question} 有 {len(failed)} 条没有得到判断：{failed}")
    return [answered[str(i)] for i in range(len(states))]


async def review(design: str, show: bool = True) -> list[dict]:
    """对每类材料各跑一批 judge，返回超过阈值的反模式，按文件与行排序。"""
    items = materials(design)
    findings = []
    for question, (_, threshold, advice) in QUESTIONS.items():
        group = [item for item in items if item["question"] == question]
        if not group:
            continue
        for item, probability in zip(group, await _probabilities(question, [item["state"] for item in group])):
            if probability >= threshold:
                findings.append({**item, "probability": probability, "advice": advice})
    findings.sort(key=lambda f: (f["path"], f["line"], f["question"]))
    if show:
        for f in findings:
            print(f"{f['path']}:{f['line']}: [review:{f['question']}] {f['advice']} (p={f['probability']:.2f})")
        print(f"模型审查：{len(items)} 条材料，{len(findings)} 处反模式。")
    return findings


async def calibrate(skill: Path = SKILL) -> bool:
    """调参集上必须零误判；留出集只报误报与漏报，不用来调措辞与阈值。返回调参集是否通过。

    校准集里 _holdout 列出的下标是留出集：正样本与反样本各自按原次序隔一条取一条。
    留出集报出误报或漏报时，先把那条情形移进调参集（删掉 _holdout 里的下标），改完措辞或阈值再重跑。
    """
    corpus = json.loads((skill / "scripts" / "review-calibration.json").read_text())
    holdout = corpus.get("_holdout", {})
    passed = True
    for question, (_, threshold, _) in QUESTIONS.items():
        rows = corpus[question]
        held_indices = set(holdout.get(question, []))
        probabilities = await _probabilities(question, [row["state"] for row in rows])
        scored = [(row, p, i in held_indices) for i, (row, p) in enumerate(zip(rows, probabilities))]
        tune = [(row, p) for row, p, held in scored if not held]
        withheld = [(row, p) for row, p, held in scored if held]
        wrong = sum(1 for row, p in tune if (p >= threshold) != row["label"])
        positive = [p for row, p in tune if row["label"]]
        negative = [p for row, p in tune if not row["label"]]
        passed = passed and wrong == 0
        line = f"{question:18s} 阈值 {threshold:.2f}  调参 {len(tune)} 条误判 {wrong}  正样本最低 {min(positive):.2f}  反样本最高 {max(negative):.2f}"
        if withheld:
            false_alarm = sum(1 for row, p in withheld if not row["label"] and p >= threshold)
            missed = sum(1 for row, p in withheld if row["label"] and p < threshold)
            line += f"  留出 {len(withheld)} 条误报 {false_alarm} 漏报 {missed}"
        else:
            line += "  没有留出样本"
        print(line)
    print("调参集通过" if passed else "调参集未通过：调整措辞或阈值后重跑")
    return passed
