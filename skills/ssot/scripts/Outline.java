import com.fujitsu.vdmj.Settings;
import com.fujitsu.vdmj.ast.definitions.ASTDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTExplicitFunctionDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTExplicitOperationDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTImplicitFunctionDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTImplicitOperationDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTStateDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTTypeDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTValueDefinition;
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
    StringBuilder out = new StringBuilder("[");
    for (int f = 0; f < args.length; f++) {
      ModuleReader reader = new ModuleReader(new LexTokenReader(new File(args[f]), Dialect.VDM_SL));
      if (f > 0) out.append(',');
      out.append("{\"path\":").append(str(args[f])).append(",\"modules\":[");
      boolean firstModule = true;
      for (ASTModule m : reader.readModules()) {
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
              .append(",\"line\":").append(from.name.location.startLine).append('}');
          }
        }
        out.append("],\"definitions\":[");
        for (int d = 0; d < m.defs.size(); d++) {
          ASTDefinition def = m.defs.get(d);
          if (d > 0) out.append(',');
          out.append("{\"name\":").append(str(nameOf(def)))
            .append(",\"kind\":").append(str(def.kind()))
            .append(",\"line\":").append(def.location.startLine)
            .append(",\"explicit\":").append(explicitBody(def))
            .append(",\"fields\":[");
          fields(out, fieldsOf(def));
          out.append("],\"findings\":");
          hits(out, findings(def));
          out.append(",\"candidates\":");
          hits(out, candidates(def));
          out.append('}');
        }
        out.append("]}");
      }
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
