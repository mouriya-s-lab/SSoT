import com.fujitsu.vdmj.Settings;
import com.fujitsu.vdmj.ast.definitions.ASTDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTExplicitFunctionDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTExplicitOperationDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTImplicitFunctionDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTImplicitOperationDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTStateDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTTypeDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTValueDefinition;
import com.fujitsu.vdmj.ast.expressions.ASTBooleanLiteralExpression;
import com.fujitsu.vdmj.ast.expressions.ASTEqualsExpression;
import com.fujitsu.vdmj.ast.expressions.ASTExpression;
import com.fujitsu.vdmj.ast.expressions.ASTIsExpression;
import com.fujitsu.vdmj.ast.expressions.ASTNotYetSpecifiedExpression;
import com.fujitsu.vdmj.ast.expressions.ASTOrExpression;
import com.fujitsu.vdmj.ast.expressions.ASTQuoteLiteralExpression;
import com.fujitsu.vdmj.ast.expressions.ASTStringLiteralExpression;
import com.fujitsu.vdmj.ast.expressions.ASTVariableExpression;
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
import com.fujitsu.vdmj.ast.types.ASTBracketType;
import com.fujitsu.vdmj.ast.types.ASTCharacterType;
import com.fujitsu.vdmj.ast.types.ASTField;
import com.fujitsu.vdmj.ast.types.ASTFieldList;
import com.fujitsu.vdmj.ast.types.ASTNamedType;
import com.fujitsu.vdmj.ast.types.ASTPatternTypePair;
import com.fujitsu.vdmj.ast.types.ASTQuoteType;
import com.fujitsu.vdmj.ast.types.ASTRecordType;
import com.fujitsu.vdmj.ast.types.ASTSeqType;
import com.fujitsu.vdmj.ast.types.ASTType;
import com.fujitsu.vdmj.ast.types.ASTUnionType;
import com.fujitsu.vdmj.ast.types.ASTUnresolvedType;
import com.fujitsu.vdmj.lex.Dialect;
import com.fujitsu.vdmj.lex.LexLocation;
import com.fujitsu.vdmj.lex.LexTokenReader;
import com.fujitsu.vdmj.messages.VDMError;
import com.fujitsu.vdmj.syntax.ModuleReader;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.HashMap;
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
        Map<String, Set<String>> unions = unions(m);
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
          hits(out, findings(def, unions));
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
  private static List<Hit> findings(ASTDefinition def, Map<String, Set<String>> unions) {
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
      } else if (node instanceof ASTNotYetSpecifiedStatement || node instanceof ASTNotYetSpecifiedExpression) {
        hits.add(new Hit("unspecified", line, "is not yet specified"));
      }
    });
    ASTExpression post = null;
    ASTPatternTypePair result = null;
    boolean implicit = false;
    if (def instanceof ASTImplicitOperationDefinition op) { implicit = true; post = op.postcondition; result = op.result; }
    if (def instanceof ASTImplicitFunctionDefinition fn && fn.body == null) { implicit = true; post = fn.postcondition; result = fn.result; }
    if (implicit && (post == null || (post instanceof ASTBooleanLiteralExpression b && b.value.value))) {
      hits.add(new Hit("no-promise", def.location.startLine, post == null ? "没有 post" : "post 恒为 true"));
    } else if (implicit && onlyNamesBranch(post, result, unions)) {
      hits.add(new Hit("no-promise", def.location.startLine, "post 只说结果是它的类型里的某一支"));
    }
    return new ArrayList<>(hits);
  }

  /** Branch labels of every union type defined in the module, by type name. */
  private static Map<String, Set<String>> unions(ASTModule m) {
    Map<String, Set<String>> unions = new HashMap<>();
    for (ASTDefinition def : m.defs) {
      if (def instanceof ASTTypeDefinition type && type.name != null) {
        ASTType body = type.type instanceof ASTNamedType named ? named.type : type.type;
        Set<String> labels = branches(body, Map.of());
        if (labels != null) unions.put(type.name.name, labels);
      }
    }
    return unions;
  }

  /** The branch labels of a union type (a named type is looked up in the module), or null when they cannot be listed. */
  private static Set<String> branches(ASTType type, Map<String, Set<String>> unions) {
    if (type instanceof ASTBracketType bracket) return branches(bracket.type, unions);
    if (type instanceof ASTUnresolvedType named) return unions.get(named.typename.name);
    if (!(type instanceof ASTUnionType union)) return null;
    Set<String> labels = new LinkedHashSet<>();
    for (ASTType member : union.types) {
      String label = label(member);
      if (label == null) return null;
      labels.add(label);
    }
    return labels;
  }

  private static String label(ASTType type) {
    if (type instanceof ASTBracketType bracket) return label(bracket.type);
    if (type instanceof ASTQuoteType quote) return "<" + quote.value + ">";
    if (type instanceof ASTUnresolvedType named) return named.typename.name;
    return null;
  }

  /**
   * True when the post is only a disjunction of tests that the result is one branch of its own union type, covering
   * every branch: `is_A(r) or is_B(r)` for a result of type `A | B`. Such a post holds for every result and promises nothing.
   */
  private static boolean onlyNamesBranch(ASTExpression post, ASTPatternTypePair result, Map<String, Set<String>> unions) {
    if (post == null || result == null || !(result.pattern instanceof ASTIdentifierPattern id)) return false;
    Set<String> all = branches(result.type, unions);
    if (all == null) return false;
    List<ASTExpression> leaves = new ArrayList<>();
    disjuncts(post, leaves);
    Set<String> named = new LinkedHashSet<>();
    for (ASTExpression leaf : leaves) {
      String label = branchTest(leaf, id.name.name);
      if (label == null) return false;
      named.add(label);
    }
    return named.containsAll(all);
  }

  private static void disjuncts(ASTExpression e, List<ASTExpression> out) {
    if (e instanceof ASTOrExpression or) {
      disjuncts(or.left, out);
      disjuncts(or.right, out);
    } else {
      out.add(e);
    }
  }

  /** The branch a leaf tests the result for (`is_A(r)` or `r = <B>`), or null when the leaf says anything else. */
  private static String branchTest(ASTExpression leaf, String result) {
    if (leaf instanceof ASTIsExpression is && isVariable(is.test, result)) {
      return is.typename != null ? is.typename.name : label(is.basictype);
    }
    if (leaf instanceof ASTEqualsExpression eq) {
      if (isVariable(eq.left, result) && eq.right instanceof ASTQuoteLiteralExpression q) return "<" + q.type.value + ">";
      if (isVariable(eq.right, result) && eq.left instanceof ASTQuoteLiteralExpression q) return "<" + q.type.value + ">";
    }
    return null;
  }

  private static boolean isVariable(ASTExpression e, String name) {
    return e instanceof ASTVariableExpression v && v.name.name.equals(name);
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
