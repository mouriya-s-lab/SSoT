import com.fujitsu.vdmj.Settings;
import com.fujitsu.vdmj.ast.definitions.ASTDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTExplicitFunctionDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTExplicitOperationDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTImplicitFunctionDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTImplicitOperationDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTStateDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTTypeDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTValueDefinition;
import com.fujitsu.vdmj.ast.expressions.ASTApplyExpression;
import com.fujitsu.vdmj.ast.expressions.ASTVariableExpression;
import com.fujitsu.vdmj.ast.lex.LexNameToken;
import com.fujitsu.vdmj.ast.modules.ASTExport;
import com.fujitsu.vdmj.ast.modules.ASTExportAll;
import com.fujitsu.vdmj.ast.modules.ASTExportedFunction;
import com.fujitsu.vdmj.ast.modules.ASTExportedOperation;
import com.fujitsu.vdmj.ast.modules.ASTExportedType;
import com.fujitsu.vdmj.ast.modules.ASTExportedValue;
import com.fujitsu.vdmj.ast.modules.ASTImport;
import com.fujitsu.vdmj.ast.modules.ASTImportAll;
import com.fujitsu.vdmj.ast.modules.ASTImportedFunction;
import com.fujitsu.vdmj.ast.modules.ASTImportedOperation;
import com.fujitsu.vdmj.ast.modules.ASTImportedType;
import com.fujitsu.vdmj.ast.statements.ASTCallStatement;
import com.fujitsu.vdmj.ast.statements.ASTCaseStmtAlternative;
import com.fujitsu.vdmj.ast.statements.ASTCasesStatement;
import com.fujitsu.vdmj.ast.statements.ASTDefStatement;
import com.fujitsu.vdmj.ast.statements.ASTElseIfStatement;
import com.fujitsu.vdmj.ast.statements.ASTExternalClause;
import com.fujitsu.vdmj.ast.statements.ASTIfStatement;
import com.fujitsu.vdmj.ast.statements.ASTLetBeStStatement;
import com.fujitsu.vdmj.ast.statements.ASTLetDefStatement;
import com.fujitsu.vdmj.ast.statements.ASTNonDeterministicStatement;
import com.fujitsu.vdmj.ast.statements.ASTSimpleBlockStatement;
import com.fujitsu.vdmj.ast.statements.ASTStatement;
import com.fujitsu.vdmj.ast.types.ASTNamedType;
import com.fujitsu.vdmj.ast.types.ASTTokenType;
import com.fujitsu.vdmj.ast.expressions.ASTAndExpression;
import com.fujitsu.vdmj.ast.expressions.ASTBooleanLiteralExpression;
import com.fujitsu.vdmj.ast.expressions.ASTEqualsExpression;
import com.fujitsu.vdmj.ast.expressions.ASTExpression;
import com.fujitsu.vdmj.ast.expressions.ASTGreaterEqualExpression;
import com.fujitsu.vdmj.ast.expressions.ASTGreaterExpression;
import com.fujitsu.vdmj.ast.expressions.ASTImpliesExpression;
import com.fujitsu.vdmj.ast.expressions.ASTLessEqualExpression;
import com.fujitsu.vdmj.ast.expressions.ASTLessExpression;
import com.fujitsu.vdmj.ast.expressions.ASTNotEqualExpression;
import com.fujitsu.vdmj.ast.expressions.ASTNotExpression;
import com.fujitsu.vdmj.ast.expressions.ASTNotYetSpecifiedExpression;
import com.fujitsu.vdmj.ast.expressions.ASTOrExpression;
import com.fujitsu.vdmj.ast.expressions.ASTStringLiteralExpression;
import com.fujitsu.vdmj.ast.modules.ASTImportFromModule;
import com.fujitsu.vdmj.ast.modules.ASTModule;
import com.fujitsu.vdmj.ast.patterns.ASTIdentifierPattern;
import com.fujitsu.vdmj.ast.statements.ASTAssignmentStatement;
import com.fujitsu.vdmj.ast.statements.ASTBlockStatement;
import com.fujitsu.vdmj.ast.statements.ASTForAllStatement;
import com.fujitsu.vdmj.ast.statements.ASTForIndexStatement;
import com.fujitsu.vdmj.ast.statements.ASTForPatternBindStatement;
import com.fujitsu.vdmj.ast.statements.ASTNotYetSpecifiedStatement;
import com.fujitsu.vdmj.ast.statements.ASTWhileStatement;
import com.fujitsu.vdmj.ast.types.ASTBooleanType;
import com.fujitsu.vdmj.ast.types.ASTCharacterType;
import com.fujitsu.vdmj.ast.types.ASTField;
import com.fujitsu.vdmj.ast.types.ASTFieldList;
import com.fujitsu.vdmj.ast.types.ASTQuoteType;
import com.fujitsu.vdmj.ast.types.ASTRecordType;
import com.fujitsu.vdmj.ast.types.ASTSeqType;
import com.fujitsu.vdmj.ast.types.ASTUnionType;
import com.fujitsu.vdmj.lex.Dialect;
import com.fujitsu.vdmj.lex.LexLocation;
import com.fujitsu.vdmj.lex.LexTokenReader;
import com.fujitsu.vdmj.messages.VDMError;
import com.fujitsu.vdmj.syntax.ModuleReader;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/**
 * Prints the module outline of literate VDM-SL files as JSON, using the VDMJ parser.
 * Besides names and fields it reports anti-pattern findings and review candidates found by AST node class,
 * never by matching source text.
 */
public class Outline {
  /** A finding or candidate: a rule id, the source line, and a short detail. */
  private record Hit(String rule, int line, String detail) {}

  public static void main(String[] args) {
    Settings.dialect = Dialect.VDM_SL;
    List<ModuleReader> readers = new ArrayList<>();
    List<List<ASTModule>> parsed = new ArrayList<>();
    for (String arg : args) {
      ModuleReader reader = new ModuleReader(new LexTokenReader(new File(arg), Dialect.VDM_SL));
      readers.add(reader);
      parsed.add(reader.readModules());
    }
    // 场景里的调用可能写成表达式（`let x = Op(a)`、`cases Op(a):`），解析器分不出它是函数还是操作，按名字认：
    // 任何模块定义的操作名，以及导入时给操作起的本地名。
    Set<String> operations = new LinkedHashSet<>();
    for (List<ASTModule> modules : parsed) {
      for (ASTModule m : modules) {
        for (ASTDefinition def : m.defs) {
          if (def instanceof ASTExplicitOperationDefinition || def instanceof ASTImplicitOperationDefinition) operations.add(nameOf(def));
        }
        if (m.imports == null) continue;
        for (ASTImportFromModule from : m.imports.imports) {
          for (ASTImport imported : from.signatures) {
            if (imported instanceof ASTImportedOperation) operations.add((imported.renamed != null ? imported.renamed : imported.name).name);
          }
        }
      }
    }
    StringBuilder out = new StringBuilder("[");
    for (int f = 0; f < args.length; f++) {
      if (f > 0) out.append(',');
      out.append("{\"path\":").append(str(args[f])).append(",\"modules\":[");
      boolean firstModule = true;
      for (ASTModule m : parsed.get(f)) {
        if (!firstModule) out.append(',');
        firstModule = false;
        out.append("{\"name\":").append(str(m.name.name))
          .append(",\"line\":").append(m.name.location.startLine)
          .append(",\"endLine\":").append(m.name.location.endLine)
          .append(",\"flat\":").append(m.isFlat)
          .append(",\"imports\":[");
        if (m.imports != null) {
          for (int i = 0; i < m.imports.imports.size(); i++) {
            ASTImportFromModule from = m.imports.imports.get(i);
            if (i > 0) out.append(',');
            out.append("{\"module\":").append(str(from.name.name))
              .append(",\"line\":").append(from.name.location.startLine)
              .append(",\"items\":[");
            for (int j = 0; j < from.signatures.size(); j++) {
              ASTImport imported = from.signatures.get(j);
              if (j > 0) out.append(',');
              out.append("{\"kind\":").append(str(importKind(imported)))
                .append(",\"name\":").append(imported.name == null ? "null" : str(imported.name.name))
                .append(",\"renamed\":").append(imported.renamed == null ? "null" : str(imported.renamed.name)).append('}');
            }
            out.append("]}");
          }
        }
        out.append("],\"exports\":");
        exports(out, m);
        out.append(",\"definitions\":[");
        for (int d = 0; d < m.defs.size(); d++) {
          ASTDefinition def = m.defs.get(d);
          if (d > 0) out.append(',');
          out.append("{\"name\":").append(str(nameOf(def)))
            .append(",\"kind\":").append(str(def.kind()))
            .append(",\"line\":").append(def.location.startLine)
            .append(",\"explicit\":").append(explicitBody(def))
            .append(",\"hasPre\":").append(precondition(def) != null)
            .append(",\"hasPost\":").append(postcondition(def) != null)
            .append(",\"hasInv\":").append(invariant(def) != null)
            .append(",\"unspecified\":").append(unspecified(def))
            .append(",\"ext\":");
          externals(out, def);
          out.append(",\"fields\":[");
          fields(out, fieldsOf(def));
          out.append("],\"scenario\":");
          scenario(out, def, operations);
          out.append(",\"findings\":");
          hits(out, findings(def));
          out.append(",\"candidates\":");
          hits(out, candidates(def));
          out.append('}');
        }
        out.append("]}");
      }
      ModuleReader reader = readers.get(f);
      out.append("],\"errors\":[");
      for (int e = 0; e < reader.getErrors().size(); e++) {
        VDMError error = reader.getErrors().get(e);
        if (e > 0) out.append(',');
        out.append("{\"line\":").append(error.location.startLine)
          .append(",\"column\":").append(error.location.startPos)
          .append(",\"message\":").append(str(error.toString())).append('}');
      }
      out.append("]}");
    }
    System.out.println(out.append(']'));
  }

  private static String importKind(ASTImport imported) {
    if (imported instanceof ASTImportAll) return "all";
    if (imported instanceof ASTImportedType) return "type";
    if (imported instanceof ASTImportedOperation) return "operation";
    if (imported instanceof ASTImportedFunction) return "function";
    return "value";
  }

  /** 导出清单：`exports all`，或逐项的种类与名字。`struct` 类型与不透明类型是两种承诺，分开记。 */
  private static void exports(StringBuilder out, ASTModule m) {
    boolean all = false;
    List<String> items = new ArrayList<>();
    if (m.exports != null) {
      for (ASTExport export : m.exports.exports) {
        if (export instanceof ASTExportAll) all = true;
        else if (export instanceof ASTExportedType type) items.add(item(type.struct ? "struct" : "type", type.name.name, export.location.startLine));
        else if (export instanceof ASTExportedOperation op) for (LexNameToken n : op.nameList) items.add(item("operation", n.name, export.location.startLine));
        else if (export instanceof ASTExportedFunction fn) for (LexNameToken n : fn.nameList) items.add(item("function", n.name, export.location.startLine));
        else if (export instanceof ASTExportedValue value) for (LexNameToken n : value.nameList) items.add(item("value", n.name, export.location.startLine));
      }
    }
    out.append("{\"all\":").append(all).append(",\"items\":[").append(String.join(",", items)).append("]}");
  }

  private static String item(String kind, String name, int line) {
    return "{\"kind\":" + str(kind) + ",\"name\":" + str(name) + ",\"line\":" + line + "}";
  }

  private static ASTExpression precondition(ASTDefinition def) {
    if (def instanceof ASTImplicitOperationDefinition op) return op.precondition;
    if (def instanceof ASTExplicitOperationDefinition op) return op.precondition;
    if (def instanceof ASTImplicitFunctionDefinition fn) return fn.precondition;
    if (def instanceof ASTExplicitFunctionDefinition fn && !fn.isTypeInvariant) return fn.precondition;
    return null;
  }

  private static ASTExpression postcondition(ASTDefinition def) {
    if (def instanceof ASTImplicitOperationDefinition op) return op.postcondition;
    if (def instanceof ASTExplicitOperationDefinition op) return op.postcondition;
    if (def instanceof ASTImplicitFunctionDefinition fn) return fn.postcondition;
    if (def instanceof ASTExplicitFunctionDefinition fn && !fn.isTypeInvariant) return fn.postcondition;
    return null;
  }

  private static ASTExpression invariant(ASTDefinition def) {
    if (def instanceof ASTTypeDefinition type) return type.invExpression;
    if (def instanceof ASTStateDefinition state) return state.invExpression;
    return null;
  }

  /** 不展开的定义：`T = token`，或体为 `is not yet specified`。约束不能藏在这里。 */
  private static boolean unspecified(ASTDefinition def) {
    if (def instanceof ASTTypeDefinition type) return type.type instanceof ASTNamedType named && named.type instanceof ASTTokenType && type.invExpression == null;
    if (def instanceof ASTExplicitOperationDefinition op) return op.body instanceof ASTNotYetSpecifiedStatement;
    if (def instanceof ASTExplicitFunctionDefinition fn) return !fn.isTypeInvariant && fn.body instanceof ASTNotYetSpecifiedExpression;
    if (def instanceof ASTImplicitFunctionDefinition fn) return fn.body instanceof ASTNotYetSpecifiedExpression;
    return false;
  }

  /** 隐式操作的 ext 子句：每一句的模式（rd、wr）与它列出的状态分量。 */
  private static void externals(StringBuilder out, ASTDefinition def) {
    out.append('[');
    if (def instanceof ASTImplicitOperationDefinition op && op.externals != null) {
      for (int i = 0; i < op.externals.size(); i++) {
        ASTExternalClause clause = op.externals.get(i);
        if (i > 0) out.append(',');
        List<String> names = new ArrayList<>();
        for (LexNameToken n : clause.identifiers) names.add(str(n.name));
        out.append("{\"mode\":").append(str(clause.mode.toString().trim()))
          .append(",\"names\":[").append(String.join(",", names)).append("]}");
      }
    }
    out.append(']');
  }

  /**
   * 场景显式体里的先后、分支、挑选与调用，各自一个节点。节点的 path 由语句结构写成（分支的模式、条件，块里的序号），
   * 不含行号：在场景外插行不改变它。
   */
  private static void scenario(StringBuilder out, ASTDefinition def, Set<String> operations) {
    List<String> nodes = new ArrayList<>();
    if (def instanceof ASTExplicitOperationDefinition op && explicitBody(def)) statement(op.body, nameOf(def), nodes, operations);
    out.append('[').append(String.join(",", nodes)).append(']');
  }

  private static void node(List<String> nodes, String kind, String path, int line, String text) {
    nodes.add("{\"kind\":" + str(kind) + ",\"path\":" + str(path) + ",\"line\":" + line + ",\"text\":" + str(text) + "}");
  }

  private static void statement(ASTStatement s, String path, List<String> nodes, Set<String> operations) {
    if (s == null) return;
    int line = s.location.startLine;
    if (s instanceof ASTCallStatement call) {
      node(nodes, "call", path + "/call " + call.name.name, line, s.toString());
      calls(call.args, path + "/call " + call.name.name, nodes, operations);
    } else if (s instanceof ASTCasesStatement cases) {
      String here = path + "/cases " + cases.exp;
      calls(cases.exp, here, nodes, operations);
      for (ASTCaseStmtAlternative alternative : cases.cases) {
        String branch = here + "/when " + alternative.pattern;
        node(nodes, "branch", branch, alternative.location.startLine, "cases " + cases.exp + ": " + alternative.pattern + " ->");
        statement(alternative.statement, branch, nodes, operations);
      }
      if (cases.others != null) {
        node(nodes, "branch", here + "/others", cases.others.location.startLine, "cases " + cases.exp + ": others ->");
        statement(cases.others, here + "/others", nodes, operations);
      }
    } else if (s instanceof ASTIfStatement branch) {
      String here = path + "/if " + branch.ifExp;
      calls(branch.ifExp, here, nodes, operations);
      node(nodes, "branch", here + "/then", line, "if " + branch.ifExp + " then");
      statement(branch.thenStmt, here + "/then", nodes, operations);
      if (branch.elseList != null) {
        for (ASTElseIfStatement elseIf : branch.elseList) {
          String alternative = here + "/elseif " + elseIf.elseIfExp;
          calls(elseIf.elseIfExp, alternative, nodes, operations);
          node(nodes, "branch", alternative, elseIf.location.startLine, "elseif " + elseIf.elseIfExp + " then");
          statement(elseIf.thenStmt, alternative, nodes, operations);
        }
      }
      if (branch.elseStmt != null) {
        node(nodes, "branch", here + "/else", branch.elseStmt.location.startLine, "else");
        statement(branch.elseStmt, here + "/else", nodes, operations);
      }
    } else if (s instanceof ASTNonDeterministicStatement choice) {
      node(nodes, "choice", path + "/||", line, "||(" + choice.statements.size() + " 条语句，次序任选)");
      for (int i = 0; i < choice.statements.size(); i++) statement(choice.statements.get(i), path + "/||" + (i + 1), nodes, operations);
    } else if (s instanceof ASTSimpleBlockStatement block) {
      if (block.statements.size() > 1) {
        List<String> steps = new ArrayList<>();
        for (ASTStatement step : block.statements) steps.add(step.toString().replaceAll("\\s+", " "));
        node(nodes, "sequence", path + "/seq", line, String.join(" ; ", steps));
      }
      for (int i = 0; i < block.statements.size(); i++) {
        statement(block.statements.get(i), block.statements.size() > 1 ? path + "/" + (i + 1) : path, nodes, operations);
      }
    } else if (s instanceof ASTLetDefStatement let) {
      calls(let.localDefs, path + "/let", nodes, operations);
      statement(let.statement, path + "/let", nodes, operations);
    } else if (s instanceof ASTDefStatement define) {
      calls(define.localDefs, path + "/def", nodes, operations);
      statement(define.statement, path + "/def", nodes, operations);
    } else if (s instanceof ASTLetBeStStatement pick) {
      String here = path + "/let be " + pick.bind + (pick.suchThat == null ? "" : " st " + pick.suchThat);
      node(nodes, "choice", here, line, "let " + pick.bind + (pick.suchThat == null ? "" : " be st " + pick.suchThat));
      statement(pick.statement, here, nodes, operations);
    } else {
      calls(s, path, nodes, operations);
    }
  }

  /** 表达式里对操作的调用（`Op(a)`），按操作名认出。 */
  private static void calls(Object root, String path, List<String> nodes, Set<String> operations) {
    walk(root, node -> {
      if (node instanceof ASTApplyExpression apply && apply.root instanceof ASTVariableExpression variable && operations.contains(variable.name.name)) {
        node(nodes, "call", path + "/call " + variable.name.name, apply.location.startLine, apply.toString());
      }
    });
  }

  /** Value definitions carry their name in the pattern, not in ASTDefinition.name. */
  private static String nameOf(ASTDefinition def) {
    if (def instanceof ASTValueDefinition value && value.pattern instanceof ASTIdentifierPattern id) return id.name.name;
    return def.name == null ? def.toString() : def.name.name;
  }

  /** An explicit body written by the author: scenarios, decisions, or implementation leaking into the design. */
  private static boolean explicitBody(ASTDefinition def) {
    if (def instanceof ASTExplicitOperationDefinition op) return op.body != null && !(op.body instanceof ASTNotYetSpecifiedStatement);
    if (def instanceof ASTExplicitFunctionDefinition fn) return !fn.isTypeInvariant && fn.body != null && !(fn.body instanceof ASTNotYetSpecifiedExpression);
    return false;
  }

  /** Hard anti-patterns: each one turns the specification into something other than a design. */
  private static List<Hit> findings(ASTDefinition def) {
    Set<Hit> hits = new LinkedHashSet<>();
    walk(def, node -> {
      int line = lineOf(node, def);
      if (node instanceof ASTStringLiteralExpression) {
        hits.add(new Hit("string-literal", line, "字符串字面量"));
      } else if (node instanceof ASTAssignmentStatement) {
        hits.add(new Hit("implementation", line, "赋值语句"));
      } else if (node instanceof ASTWhileStatement || node instanceof ASTForIndexStatement
          || node instanceof ASTForAllStatement || node instanceof ASTForPatternBindStatement) {
        hits.add(new Hit("implementation", line, "循环语句"));
      } else if (node instanceof ASTBlockStatement block && block.assignmentDefs != null && !block.assignmentDefs.isEmpty()) {
        hits.add(new Hit("implementation", line, "局部变量声明（dcl）"));
      }
    });
    ASTExpression post = null;
    boolean implicit = false;
    if (def instanceof ASTImplicitOperationDefinition op) { implicit = true; post = op.postcondition; }
    if (def instanceof ASTImplicitFunctionDefinition fn && fn.body == null) { implicit = true; post = fn.postcondition; }
    if (implicit && (post == null || (post instanceof ASTBooleanLiteralExpression b && b.value.value))) {
      hits.add(new Hit("no-promise", def.location.startLine, post == null ? "没有 post" : "post 恒为 true"));
    }
    // 约束的强度：post 与不变式恒真就什么也没说，恒不可满足就什么也不允许。字面 true 的 post 由 no-promise 报。
    if (post != null) constraintStrength("post", post, true, def, hits);
    if (def instanceof ASTExplicitOperationDefinition explicit) constraintStrength("post", explicit.postcondition, true, def, hits);
    if (def instanceof ASTExplicitFunctionDefinition function && !function.isTypeInvariant) constraintStrength("post", function.postcondition, true, def, hits);
    if (def instanceof ASTTypeDefinition type) constraintStrength("inv", type.invExpression, false, def, hits);
    if (def instanceof ASTStateDefinition state) constraintStrength("inv", state.invExpression, false, def, hits);
    return new ArrayList<>(hits);
  }

  /**
   * 恒真或恒不可满足的约束。写出条件却排除不了任何情形（或排除了全部情形）时，规格空转：读的人与检查器都核不出承诺。
   * 两边是否相同按表达式的可打印形式判断——那仍然是语法树上的判断，不是比对源码文本。
   */
  private static void constraintStrength(String kind, ASTExpression expr, boolean literalTrueReportedElsewhere, ASTDefinition def, Set<Hit> hits) {
    if (expr == null) return;
    Trivial trivial = trivial(expr);
    if (trivial == null) return;
    if (literalTrueReportedElsewhere && trivial.reason().equals("恒为 true")) return;
    hits.add(new Hit(trivial.verdict(), lineOf(expr, def), kind + " " + trivial.reason()));
  }

  /** 约束里恒真或恒不可满足的部分，以及它是哪一种：`tautology` 恒真，`contradiction` 恒不成立。 */
  private record Trivial(String verdict, String reason) {}

  /** 只看语法树上确定的部分：字面真假、同一表达式的自比较、否定、`P or not P` 与它们的或、与组合。 */
  private static Trivial trivial(ASTExpression expr) {
    if (expr instanceof ASTBooleanLiteralExpression literal) {
      return literal.value.value ? new Trivial("tautology", "恒为 true") : new Trivial("contradiction", "恒为 false");
    }
    if (expr instanceof ASTNotExpression not) {
      if (not.exp instanceof ASTBooleanLiteralExpression inner) {
        return inner.value.value ? new Trivial("contradiction", "是 not true") : new Trivial("tautology", "是 not false");
      }
      Trivial inside = trivial(not.exp);
      if (inside == null) return null;
      boolean tautology = inside.verdict().equals("tautology");
      return new Trivial(tautology ? "contradiction" : "tautology", "否定了" + (tautology ? "一个恒真的条件" : "一个恒不成立的条件"));
    }
    if (expr instanceof ASTOrExpression either) {
      if (negationOf(either.left, either.right) || negationOf(either.right, either.left)) return new Trivial("tautology", "是 P or not P");
      return side(either.left, either.right, "tautology", "有一支");
    }
    if (expr instanceof ASTAndExpression both) {
      if (negationOf(both.left, both.right) || negationOf(both.right, both.left)) return new Trivial("contradiction", "是 P and not P");
      Trivial contradiction = side(both.left, both.right, "contradiction", "有一支");
      return contradiction != null ? contradiction : side(both.left, both.right, "tautology", "有一支");
    }
    if (expr instanceof ASTEqualsExpression equal && same(equal.left, equal.right)) return new Trivial("tautology", "的两边相同（e = e）");
    if (expr instanceof ASTNotEqualExpression unequal && same(unequal.left, unequal.right)) return new Trivial("contradiction", "的两边相同（e <> e）");
    if (expr instanceof ASTLessExpression less && same(less.left, less.right)) return new Trivial("contradiction", "的两边相同（e < e）");
    if (expr instanceof ASTGreaterExpression greater && same(greater.left, greater.right)) return new Trivial("contradiction", "的两边相同（e > e）");
    if (expr instanceof ASTLessEqualExpression atMost && same(atMost.left, atMost.right)) return new Trivial("tautology", "的两边相同（e <= e）");
    if (expr instanceof ASTGreaterEqualExpression atLeast && same(atLeast.left, atLeast.right)) return new Trivial("tautology", "的两边相同（e >= e）");
    if (expr instanceof ASTImpliesExpression implies && same(implies.left, implies.right)) return new Trivial("tautology", "是 P => P");
    return null;
  }

  /** 或、与的一支（或两支）已经恒真或恒不成立时，整个表达式也恒真或恒不成立。 */
  private static Trivial side(ASTExpression left, ASTExpression right, String verdict, String where) {
    for (ASTExpression operand : List.of(left, right)) {
      Trivial part = trivial(operand);
      if (part != null && part.verdict().equals(verdict)) return new Trivial(verdict, part.reason().startsWith(where) ? part.reason() : where + part.reason());
    }
    return null;
  }

  /** 两个表达式相同：可打印形式一致，例如 `r` 与 `r`、`x + 1` 与 `x + 1`。 */
  private static boolean same(ASTExpression left, ASTExpression right) {
    return left != null && right != null && left.toString().equals(right.toString());
  }

  /** `other` 是 `expr` 的否定。 */
  private static boolean negationOf(ASTExpression expr, ASTExpression other) {
    if (other instanceof ASTNotExpression not && same(not.exp, expr)) return true;
    if (expr instanceof ASTEqualsExpression eq && other instanceof ASTNotEqualExpression neq) {
      return (same(eq.left, neq.left) && same(eq.right, neq.right)) || (same(eq.left, neq.right) && same(eq.right, neq.left));
    }
    return false;
  }

  /** Shapes that are anti-patterns only in some contexts; the model-based review decides each one. */
  private static List<Hit> candidates(ASTDefinition def) {
    Set<Hit> hits = new LinkedHashSet<>();
    walk(def, node -> {
      if (node instanceof ASTSeqType seq && seq.seqof instanceof ASTCharacterType) {
        hits.add(new Hit("string-type", lineOf(node, def), "seq of char"));
      } else if (node instanceof ASTUnionType union) {
        long quotes = union.types.stream().filter(t -> t instanceof ASTQuoteType).count();
        if (quotes >= 4) hits.add(new Hit("quote-union", lineOf(node, def), quotes + " 个 quote 分支"));
      }
    });
    long bools = fieldsOf(def).stream().filter(field -> field.type instanceof ASTBooleanType).count();
    if (bools >= 2) hits.add(new Hit("bool-fields", def.location.startLine, bools + " 个 bool 字段"));
    return new ArrayList<>(hits);
  }

  /** Visits every VDMJ AST object reachable from the root through fields and collections, once each. */
  private static void walk(Object root, Consumer<Object> visit) {
    walk(root, new IdentityHashMap<>(), visit);
  }

  private static void walk(Object node, IdentityHashMap<Object, Boolean> seen, Consumer<Object> visit) {
    if (node == null || node instanceof String || node instanceof Number || node instanceof Boolean
        || node instanceof Character || node instanceof Enum<?> || node instanceof LexLocation || node instanceof File) return;
    if (seen.put(node, Boolean.TRUE) != null) return;
    visit.accept(node);
    if (node instanceof Iterable<?> items) {
      for (Object item : items) walk(item, seen, visit);
      return;
    }
    if (node instanceof Map<?, ?> map) {
      for (Object value : map.values()) walk(value, seen, visit);
      return;
    }
    if (!node.getClass().getName().startsWith("com.fujitsu.vdmj.ast")) return;
    for (Class<?> c = node.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
      for (Field field : c.getDeclaredFields()) {
        if (Modifier.isStatic(field.getModifiers()) || field.getType().isPrimitive()) continue;
        try {
          field.setAccessible(true);
          walk(field.get(node), seen, visit);
        } catch (ReflectiveOperationException | RuntimeException e) {
          // A field the runtime refuses to open holds no AST content we need.
        }
      }
    }
  }

  /** The node's own location when it has one, else the enclosing definition's line. */
  private static int lineOf(Object node, ASTDefinition def) {
    for (Class<?> c = node.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
      try {
        Field field = c.getDeclaredField("location");
        field.setAccessible(true);
        if (field.get(node) instanceof LexLocation location) return location.startLine;
      } catch (ReflectiveOperationException | RuntimeException e) {
        // Keep looking in the superclass.
      }
    }
    return def.location.startLine;
  }

  private static ASTFieldList fieldsOf(ASTDefinition def) {
    if (def instanceof ASTStateDefinition state) return state.fields;
    if (def instanceof ASTTypeDefinition type && type.type instanceof ASTRecordType record) return record.fields;
    return new ASTFieldList();
  }

  private static void fields(StringBuilder out, ASTFieldList fields) {
    for (int i = 0; i < fields.size(); i++) {
      ASTField field = fields.get(i);
      if (i > 0) out.append(',');
      out.append("{\"name\":").append(str(field.tag))
        .append(",\"line\":").append(field.tagname.location.startLine).append('}');
    }
  }

  private static void hits(StringBuilder out, List<Hit> hits) {
    out.append('[');
    for (int i = 0; i < hits.size(); i++) {
      Hit hit = hits.get(i);
      if (i > 0) out.append(',');
      out.append("{\"rule\":").append(str(hit.rule()))
        .append(",\"line\":").append(hit.line())
        .append(",\"detail\":").append(str(hit.detail())).append('}');
    }
    out.append(']');
  }

  private static String str(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      switch (c) {
        case '"' -> b.append("\\\"");
        case '\\' -> b.append("\\\\");
        case '\n' -> b.append("\\n");
        case '\r' -> b.append("\\r");
        case '\t' -> b.append("\\t");
        default -> {
          if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
          else b.append(c);
        }
      }
    }
    return b.append('"').toString();
  }
}
