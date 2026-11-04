# 结构的写法（LikeC4）

结构载体的规则在 `ssot` 总纲第二节「LikeC4：逐层放大的架构图」，本文件只补充写一层、写部署时会用到的语法，以及工具会拒绝什么。完整的范例是 soroi 示例设计的 [`structure/soroi.c4`](../../ssot/references/example/design/structure/soroi.c4)，它的渲染图用 `ssot render` 导出。

## 一、一层的样子

写元素 E 的一层，就是在 E 的块里写它的直接子元素、在本层声明子元素之间以及子元素与外部元素之间的关系、写 E 的视图。soroi 示例里 `engine` 的一层（节选）：

```text
engine = container 'Engine' {
  technology 'Daemon process'
  description '受理运行请求，推进并收束运行'

  control = component 'Control' {
    #contract
    description '使用方与引擎之间唯一的操作面'
  }
  scheduler = component 'Scheduler' {
    description '准入运行项并判定运行是否自然完成'
  }
}

caller -> soroi.engine.control '提交启动、停止与派生请求'
soroi.engine.control -> soroi.engine.scheduler '交出新运行'
soroi.engine.scheduler -> soroi.store '读取运行事实并登记运行项'
```

```text
view engineView of soroi.engine {
  title 'Engine 组件图'
  description 'Engine 内部由哪些功能块组成，它们之间以及与外部怎样调用'
  include *
}
```

- 关系可以写在模型末尾，也可以写在元素块里（`-> soroi.store '读取运行事实'`，源是所在元素）。跨文件引用元素时写全 fqn。
- `include *` 显示被展开元素、它的直接子元素与有关系的外部元素。需要突出或分组时用视图规则，不改模型：

```text
view engineView of soroi.engine {
  title 'Engine 组件图'
  description 'Engine 内部由哪些功能块组成，它们之间以及与外部怎样调用'
  include *
  group '受理' {
    include soroi.engine.control
  }
}
```

## 二、部署

```text
specification {
  deploymentNode host
  tag untrusted
}
deployment {
  host daemonHost 'Daemon host' {
    description '运行 soroi 守护进程与事实源头的主机'
    instanceOf soroi.engine
    instanceOf soroi.store
  }
  host execEnv 'Execution environment' {
    #untrusted
    description '实现者提供的执行环境，与核心分属不同的信任边界'
    instanceOf soroi.workspace
    instanceOf preset
  }
}
views {
  deployment view deployed {
    title 'soroi 部署图'
    description 'soroi 的容器运行在哪些主机上，信任边界在哪里'
    include daemonHost.**
    include execEnv.**
    exclude * -> * where source.kind is component or target.kind is component
    style daemonHost.engine {
      notation 'Container'
    }
    style execEnv.workspace {
      notation 'Container'
    }
    style daemonHost.store {
      shape storage
      notation 'Container: Data Store'
    }
    style execEnv.preset {
      color muted
      notation 'External Software System'
    }
    style execEnv {
      color red
      notation 'Untrusted execution environment'
    }
  }
}
```

部署视图的 id 就是部署切片的名字。部署模型不在任何逻辑视图里，它的诊断按全局报告，部署切片的检查用 `ssot check <design> --scope index`。

部署视图里的 `style` 只能按实例或节点的路径选中（`daemonHost.store`、`execEnv`）；按标签或种类选中的样式规则 LikeC4 不支持，写了以后整个视图不被导出。

## 三、自查渲染图

写完一层，运行 `ssot render <design>`，按它列出的顺序看图：上一层的图里本层被展开的框，与本层的图是否讲的是同一件事；本层的图离开模型源文件能不能读懂；本层有没有出现下一层才该出现的名字与措辞。评审者只看这些图。

## 四、工具会拒绝什么

`ssot check` 把下面这些当错误：

| 规则 | 拒绝什么 |
|---|---|
| `compile.c4` | LikeC4 语法与引用错误 |
| `struct.kinds` | 四种之外的元素种类；声明或使用关系种类 |
| `struct.nesting` | actor 或 system 不在顶层；actor 有子元素；container 不在 system 里；component 不在 container 里 |
| `struct.layering` | actor 带 `#business`；`#business` 重复标在业务元素的后代上 |
| `struct.views` | `index` 缺失或不唯一；有子元素的元素没有恰好一个 `view of`；视图显示孙辈或无关的外部元素；动态视图 |
| `struct.ids` | 带 `#contract` 的元素或其祖先的 id 含字母数字以外的字符（模块名由 fqn 映射） |
| `vocab.slots` | 元素种类、标签、metadata 的键或值等于契约或行为里的名字 |
| `contract.module` | `#contract` 写在有子元素的元素上；`#contract` 与契约文件、模块名不一一对应 |
| `gen.fresh` | `.gen/structure.json` 与重新生成的结果不一致（它只由 `ssot gen` 写出，不手改） |

标题与描述工具不扫描，交给渲染图评审。
