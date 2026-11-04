import type { Mutation } from "../mutations";

export const cases: readonly Mutation[] = [
  {
    id: "contract-body-explicit-while",
    expect: "contract.body",
    description: "显式操作的 dcl、赋值和 while 由 VDMJ 节点位置拒绝",
    regen: true,
    edits: [
      {
        file: "contract/shop.ledger.vdmsl",
        find: "  record(o : OrderId, amount : nat)\n  ext wr entries\n      rd closed\n  pre o not in set dom entries and o not in set closed\n  post entries = entries~ munion {o |-> amount};",
        replace: "  record : OrderId * nat ==> ()\n  record(o, amount) ==\n    (dcl i : nat := 0;\n     while i < 1 do i := i + 1;\n     entries := entries munion {o |-> amount})\n  pre o not in set dom entries and o not in set closed\n  post entries = entries~ munion {o |-> amount};",
      },
    ],
  },
];
