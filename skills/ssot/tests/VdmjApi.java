import com.fujitsu.vdmj.Settings;
import com.fujitsu.vdmj.ast.modules.ASTModuleList;
import com.fujitsu.vdmj.in.INNode;
import com.fujitsu.vdmj.in.expressions.INExpression;
import com.fujitsu.vdmj.in.modules.INModuleList;
import com.fujitsu.vdmj.lex.Dialect;
import com.fujitsu.vdmj.lex.LexLocation;
import com.fujitsu.vdmj.lex.LexTokenReader;
import com.fujitsu.vdmj.lex.Token;
import com.fujitsu.vdmj.mapper.ClassMapper;
import com.fujitsu.vdmj.runtime.ContextException;
import com.fujitsu.vdmj.runtime.ModuleInterpreter;
import com.fujitsu.vdmj.runtime.StateContext;
import com.fujitsu.vdmj.syntax.ExpressionReader;
import com.fujitsu.vdmj.syntax.ModuleReader;
import com.fujitsu.vdmj.tc.TCNode;
import com.fujitsu.vdmj.tc.definitions.TCDefinition;
import com.fujitsu.vdmj.tc.definitions.TCDefinitionList;
import com.fujitsu.vdmj.tc.definitions.TCLocalDefinition;
import com.fujitsu.vdmj.tc.definitions.TCStateDefinition;
import com.fujitsu.vdmj.tc.definitions.TCTypeDefinition;
import com.fujitsu.vdmj.tc.expressions.TCExpression;
import com.fujitsu.vdmj.tc.lex.TCNameToken;
import com.fujitsu.vdmj.tc.modules.TCModuleList;
import com.fujitsu.vdmj.tc.types.TCNamedType;
import com.fujitsu.vdmj.tc.types.TCRecordType;
import com.fujitsu.vdmj.typechecker.Environment;
import com.fujitsu.vdmj.typechecker.FlatEnvironment;
import com.fujitsu.vdmj.typechecker.ModuleTypeChecker;
import com.fujitsu.vdmj.typechecker.TypeChecker;
import com.fujitsu.vdmj.values.FunctionValue;
import com.fujitsu.vdmj.values.RecordValue;
import com.fujitsu.vdmj.values.SeqValue;
import com.fujitsu.vdmj.values.TokenValue;
import com.fujitsu.vdmj.values.Value;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.List;

public class VdmjApi {
  private static final String SPEC = """
    module Records
    exports all
    definitions
    types
      Item :: n : nat;
      NamedItem = Item;
    end Records

    module Api
    exports all
    definitions
    state ProbeState of
      count : nat
    init s == s = mk_ProbeState(7)
    end
    functions
      less : seq of nat * seq of nat -> bool
      less(a, b) ==
        if len a = 2 and a = b then hd (tl (tl a)) = 0
        else if len a = 1 or len b = 1 then
          (hd a < hd b) or (hd a = hd b and len a < len b)
        else if hd a = hd b then less(tl a, tl b)
        else hd a < hd b
      measure len a;
    end Api
    """;

  @FunctionalInterface
  private interface Check { String run() throws Throwable; }
  private record Result(String id, boolean ok, String detail) {}
  private record Fixture(ModuleInterpreter interpreter, TCDefinitionList types) {}

  private static void require(boolean condition, String detail) {
    if (!condition) throw new AssertionError(detail);
  }

  private static TCNameToken name(String module, String local) {
    return new TCNameToken(LexLocation.ANY, module, local);
  }

  private static Fixture fixture() throws Exception {
    Settings.dialect = Dialect.VDM_SL;
    Settings.prechecks = true;
    Settings.postchecks = true;
    Settings.invchecks = true;
    Settings.dynamictypechecks = true;
    Settings.measureChecks = true;
    ModuleReader reader = new ModuleReader(new LexTokenReader(SPEC, Dialect.VDM_SL));
    ASTModuleList ast;
    try {
      ast = reader.readModules();
      require(reader.getErrorCount() == 0, "Spec parse errors: " + reader.getErrors());
    } finally {
      reader.close();
    }
    TypeChecker.clearErrors();
    TCModuleList tc = ClassMapper.getInstance(TCNode.MAPPINGS).init().convert(ast);
    tc.combineDefaults();
    new ModuleTypeChecker(tc).typeCheck();
    require(TypeChecker.getErrorCount() == 0, "Spec type errors: " + TypeChecker.getErrors());
    INModuleList in = ClassMapper.getInstance(INNode.MAPPINGS).init().convert(tc);
    ModuleInterpreter interpreter = new ModuleInterpreter(in, tc);
    interpreter.init();
    interpreter.setDefaultName("Api");
    TCDefinitionList types = new TCDefinitionList();
    for (var module : tc) for (TCDefinition definition : module.defs) {
      if (definition instanceof TCTypeDefinition || definition instanceof TCStateDefinition) types.add(definition);
    }
    return new Fixture(interpreter, types);
  }

  private static StateContext context(ModuleInterpreter interpreter) {
    StateContext context = new StateContext(LexLocation.ANY, "VDMJ API probe",
      interpreter.getInitialContext(), interpreter.getStateContext());
    context.setThreadState(null);
    context.threadState.init();
    return context;
  }

  private static INExpression expression(ModuleInterpreter interpreter, String module,
      String source, Environment environment) throws Exception {
    interpreter.setDefaultName(module);
    LexTokenReader lexer = new LexTokenReader(source, Dialect.VDM_SL);
    ExpressionReader reader = new ExpressionReader(lexer);
    try {
      reader.setCurrentModule(module);
      TCExpression expression = ClassMapper.getInstance(TCNode.MAPPINGS).convertLocal(reader.readExpression());
      require(lexer.getLast().is(Token.EOF), "Trailing expression input: " + source);
      interpreter.typeCheck(expression, environment);
      return ClassMapper.getInstance(INNode.MAPPINGS).convertLocal(expression);
    } finally {
      reader.close();
    }
  }

  private static Environment allTypes(Fixture fixture) {
    return new FlatEnvironment(fixture.types(), fixture.interpreter().getGlobalEnvironment());
  }

  private static TCDefinition findType(Environment environment, String local) {
    TCDefinition definition = environment.findType(name("Records", local), "Api");
    require(definition != null, "Records`" + local + " was not found from Api");
    return definition;
  }

  private static String moduleInterpreter() throws Exception {
    Fixture fixture = fixture();
    ModuleInterpreter interpreter = fixture.interpreter();
    StateContext context = context(interpreter);
    RecordValue state = interpreter.getStateContext().lookup(name("Api", "ProbeState")).recordValue(context);
    require(state.fieldmap.get("count").intValue(context) == 7, "State init did not yield count = 7");
    Value result = expression(interpreter, "Api", "count + 1", interpreter.getGlobalEnvironment()).eval(context);
    require(result.intValue(context) == 8, "Typechecked state expression did not evaluate to 8");
    return "constructor/init/default module/state lookup/global environment/initial context/typeCheck: count = 7, count + 1 = 8";
  }

  private static String flatEnvironment() throws Exception {
    Fixture fixture = fixture();
    require(fixture.interpreter().getGlobalEnvironment().findType(name("Records", "Item"), "Api") == null,
      "Probe requires Api not to import Records`Item");
    TCDefinition definition = findType(allTypes(fixture), "Item");
    require(definition.getType() instanceof TCRecordType record && record.name.equals(name("Records", "Item")),
      "findType did not return the qualified record type");
    return "FlatEnvironment(all types, global environment).findType resolves unimported Records`Item from Api";
  }

  private static String localDefinition() throws Exception {
    Fixture fixture = fixture();
    ModuleInterpreter interpreter = fixture.interpreter();
    Environment environment = allTypes(fixture);
    TCDefinitionList locals = new TCDefinitionList();
    TCNameToken local = name("Api", "bound");
    locals.add(new TCLocalDefinition(LexLocation.ANY, local, findType(environment, "Item").getType()));
    Value value = expression(interpreter, "Records", "mk_Item(7)", environment).eval(context(interpreter));
    interpreter.setDefaultName("Api");
    StateContext context = context(interpreter);
    context.put(local, value);
    Value result = expression(interpreter, "Api", "bound.n + 1", new FlatEnvironment(locals, environment)).eval(context);
    require(result.intValue(context) == 8, "Typed local record reference did not evaluate to 8");
    return "TCLocalDefinition(location, name, record type) makes bound.n + 1 typecheck and evaluate to 8";
  }

  private static String convertTo() throws Exception {
    Fixture fixture = fixture();
    ModuleInterpreter interpreter = fixture.interpreter();
    Environment environment = allTypes(fixture);
    var type = findType(environment, "NamedItem").getType();
    require(type instanceof TCNamedType, "Conversion target is not a named type");
    Value value = expression(interpreter, "Records", "mk_Item(7)", environment).eval(context(interpreter));
    StateContext context = context(interpreter);
    Value converted = value.convertTo(type, context);
    require(converted.recordValue(context).fieldmap.get("n").intValue(context) == 7 && converted.equals(value),
      "Record payload changed during conversion to named type");
    return "Value.convertTo(TCType, Context) converts mk_Item(7) to Records`NamedItem and preserves n = 7";
  }

  private static String tokenValue() throws Exception {
    Fixture fixture = fixture();
    ModuleInterpreter interpreter = fixture.interpreter();
    StateContext context = context(interpreter);
    Value token = expression(interpreter, "Api", "mk_token(\"o1\")", interpreter.getGlobalEnvironment()).eval(context);
    require(token instanceof TokenValue, "mk_token did not produce TokenValue");
    var field = TokenValue.class.getDeclaredField("value");
    field.setAccessible(true);
    Object payload = field.get(token);
    require(payload instanceof SeqValue sequence && sequence.stringValue(context).equals("o1"),
      "TokenValue.value did not expose the char sequence o1");
    return "TokenValue.value reflection exposes mk_token(\"o1\") payload as SeqValue(\"o1\")";
  }

  private static String onThread(String name, Check check) throws Throwable {
    String[] result = new String[1];
    Throwable[] failure = new Throwable[1];
    Thread worker = new Thread(() -> {
      try { result[0] = check.run(); }
      catch (Throwable error) { failure[0] = error; }
    }, name);
    worker.setDaemon(true);
    worker.start();
    worker.join(10_000);
    if (worker.isAlive()) {
      worker.interrupt();
      throw new AssertionError(name + " exceeded 10s");
    }
    if (failure[0] != null) throw failure[0];
    return result[0];
  }

  private static String functionMeasure() throws Throwable {
    Fixture fixture = fixture();
    ModuleInterpreter interpreter = fixture.interpreter();
    Environment environment = interpreter.getGlobalEnvironment();
    INExpression aborting = expression(interpreter, "Api", "less([1,1,1], [1,1,1])", environment);
    INExpression succeeding = expression(interpreter, "Api", "less([1,1,1], [1,1,2])", environment);
    Value function = interpreter.getInitialContext().lookup(name("Api", "less"));
    require(function instanceof FunctionValue measured && measured.measure != null, "less has no active measure function");
    onThread("vdmj-api-abort", () -> {
      try { aborting.eval(context(interpreter)); }
      catch (ContextException error) {
        require(error.rawMessage.toLowerCase(java.util.Locale.ROOT).contains("empty"),
          "Expected hd of an empty sequence inside recursive less, got " + error);
        return "aborted after len a decreased from 3 to 2";
      }
      throw new AssertionError("Recursive less did not abort");
    });
    onThread("vdmj-api-retry", () -> {
      StateContext context = context(interpreter);
      require(succeeding.eval(context).boolValue(context), "Later less evaluation did not return true");
      require(interpreter.getInitialContext().lookup(name("Api", "less")) == function,
        "Later evaluation did not reuse the same FunctionValue");
      return "true";
    });
    return "behavioral: less (measure len a) aborts inside recursion on one thread; same FunctionValue returns true on another thread";
  }

  private static Result check(String id, Check check) {
    try { return new Result(id, true, check.run()); }
    catch (Throwable error) { return new Result(id, false, error.getClass().getName() + ": " + error.getMessage()); }
  }

  private static String json(String text) {
    StringBuilder out = new StringBuilder("\"");
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          if (c < 0x20) out.append(String.format("\\u%04x", (int)c));
          else out.append(c);
        }
      }
    }
    return out.append('"').toString();
  }

  public static void main(String[] args) {
    PrintStream stdout = System.out;
    System.setOut(System.err);
    List<Result> results = List.of(
      check("ModuleInterpreter", VdmjApi::moduleInterpreter),
      check("FlatEnvironment", VdmjApi::flatEnvironment),
      check("TCLocalDefinition", VdmjApi::localDefinition),
      check("Value.convertTo", VdmjApi::convertTo),
      check("TokenValue.value", VdmjApi::tokenValue),
      check("FunctionValue.measure", VdmjApi::functionMeasure));
    List<String> rows = new ArrayList<>();
    for (Result result : results) rows.add("{\"id\":" + json(result.id()) + ",\"ok\":" + result.ok()
      + ",\"detail\":" + json(result.detail()) + "}");
    stdout.println("[" + String.join(",", rows) + "]");
  }
}
