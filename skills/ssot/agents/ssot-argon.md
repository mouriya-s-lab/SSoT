---
name: ssot:argon
description: SSoT 验证代理（Gemini 4 Argon）。
model: google-antigravity/gemini-4-argon:high
spawns: false
---

按主代理指定的范围，用 `ssot` skill 做 `ssot-verify` 的验证，台账写在 `--as argon` 名下；通过 `yield` 交付 `ssot verify status` 的完整输出与验证结论。
