import com.fujitsu.vdmj.Settings;
import com.fujitsu.vdmj.ast.modules.ASTModuleList;
import com.fujitsu.vdmj.lex.*;
import com.fujitsu.vdmj.syntax.ModuleReader;
import com.fujitsu.vdmj.syntax.ExpressionReader;
import com.fujitsu.vdmj.tc.expressions.TCExpression;
import com.fujitsu.vdmj.tc.expressions.*;
import com.fujitsu.vdmj.tc.expressions.visitors.TCLeafExpressionVisitor;
import com.fujitsu.vdmj.tc.statements.*;
import com.fujitsu.vdmj.tc.statements.visitors.TCLeafStatementVisitor;
import com.fujitsu.vdmj.tc.definitions.visitors.TCLeafDefinitionVisitor;
import com.fujitsu.vdmj.tc.patterns.visitors.*;
import com.fujitsu.vdmj.tc.types.visitors.TCLeafTypeVisitor;
import com.fujitsu.vdmj.tc.TCVisitorSet;
import com.fujitsu.vdmj.in.definitions.INExplicitFunctionDefinition;
import quickcheck.visitors.FixedRangeCreator;
import com.fujitsu.vdmj.in.expressions.INExpression;
import com.fujitsu.vdmj.mapper.ClassMapper;
import com.fujitsu.vdmj.tc.TCNode;
import com.fujitsu.vdmj.tc.modules.*;
import com.fujitsu.vdmj.tc.definitions.*;
import com.fujitsu.vdmj.tc.patterns.*;
import com.fujitsu.vdmj.tc.types.*;
import com.fujitsu.vdmj.tc.lex.TCNameToken;
import com.fujitsu.vdmj.typechecker.*;
import com.fujitsu.vdmj.po.PONode;
import com.fujitsu.vdmj.po.modules.POModuleList;
import com.fujitsu.vdmj.in.INNode;
import com.fujitsu.vdmj.pog.*;
import quickcheck.QuickCheck;
import quickcheck.commands.QCConsole;
import com.fujitsu.vdmj.in.modules.INModuleList;
import com.fujitsu.vdmj.runtime.*;
import com.fujitsu.vdmj.messages.*;
import com.fujitsu.vdmj.values.*;
import java.io.*;
import java.util.*;
import java.util.function.Function;

public class Vdm {
  // A small JSON boundary algebra; all compiler data stays in VDMJ's typed models.
  sealed interface J permits Obj, Arr, Str, Num, Bool, Nil {}
  record Obj(LinkedHashMap<String,J> fields) implements J {}
  record Arr(List<J> items) implements J {}
  record Str(String value) implements J {}
  record Num(Number value) implements J {}
  record Bool(boolean value) implements J {}
  record Nil() implements J {}
  static J s(String x) { return x == null ? new Nil() : new Str(x); }
  static J b(boolean x) { return new Bool(x); }
  static J n(Number x) { return new Num(x); }
  static Obj obj() { return new Obj(new LinkedHashMap<>()); }
  static Obj put(Obj x, String k, J v) { x.fields.put(k,v); return x; }
  static <T> Arr array(Iterable<T> xs, Function<T,J> fn) {
    List<J> out = new ArrayList<>(); for (T x:xs) out.add(fn.apply(x)); return new Arr(out);
  }
  static Obj tagged(String kind) { return put(obj(),"kind",s(kind)); }
  static J loc(LexLocation l) {
    if (l == null) return new Nil();
    Obj x=obj(); put(x,"file",s(l.file.getPath())); put(x,"module",s(l.module));
    put(x,"line",n(l.startLine)); put(x,"col",n(l.startPos));
    put(x,"endLine",n(l.endLine)); put(x,"endCol",n(l.endPos)); return x;
  }
  static J diagnostic(VDMMessage m, String severity) {
    Obj x=obj(); put(x,"severity",s(severity)); put(x,"number",n(m.number)); put(x,"message",s(m.message));
    x.fields.putAll(((Obj)loc(m.location)).fields); return x;
  }
  static J diagnostics(List<? extends VDMMessage> errors, List<? extends VDMMessage> warnings) {
    List<J> ds=new ArrayList<>(); for (var e:errors) ds.add(diagnostic(e,"error"));
    for (var w:warnings) ds.add(diagnostic(w,"warning")); return new Arr(ds);
  }
  static J error(Exception e) {
    Obj x=tagged("error"); put(x,"exception",s(e.getClass().getName()));
    if(e instanceof ContextException c) { put(x,"message",s(c.rawMessage)); put(x,"number",n(c.number)); put(x,"location",loc(c.location)); }
    else { put(x,"message",s(e.getMessage()));
      if(e instanceof NumberedException c) put(x,"number",n(c.number));
      if(e instanceof LocatedException c) put(x,"location",loc(c.location));
      if(e instanceof VDMErrorsException c) {
        put(x,"diagnostics",diagnostics(c.errors,List.of()));
        if(!c.errors.isEmpty()) {
          VDMError first=c.errors.get(0);
          put(x,"number",n(first.number)); put(x,"message",s(first.message)); put(x,"location",loc(first.location));
        }
      }
    }
    return x;
  }
  static J ref(TCNameToken name) {
    Obj x=tagged("ref"); put(x,"module",s(name.getModule())); put(x,"name",s(name.getName())); return x;
  }
  static J fields(TCFieldList fs) { return array(fs,f->{ Obj x=obj(); put(x,"name",s(f.tag)); put(x,"type",type(f.type,false)); return x; }); }
  static J type(TCType t, boolean expand) {
    if(t==null) return new Nil();
    if(t instanceof TCNamedType x) return expand ? type(x.type,false) : ref(x.typename);
    if(t instanceof TCRecordType x) {
      if(!expand) return ref(x.name);
      Obj j=tagged("record"); put(j,"module",s(x.name.getModule())); put(j,"name",s(x.name.getName())); put(j,"fields",fields(x.fields)); return j;
    }
    if(t instanceof TCQuoteType x) return put(tagged("quote"),"value",s(x.value));
    if(t instanceof TCSeqType x) return put(tagged(t instanceof TCSeq1Type ? "seq1":"seq"),"element",type(x.seqof,false));
    if(t instanceof TCSetType x) return put(tagged(t instanceof TCSet1Type ? "set1":"set"),"element",type(x.setof,false));
    if(t instanceof TCMapType x) { Obj j=tagged(t instanceof TCInMapType ? "inmap":"map"); put(j,"from",type(x.from,false)); put(j,"to",type(x.to,false)); return j; }
    if(t instanceof TCOptionalType x) return put(tagged("optional"),"type",type(x.type,false));
    if(t instanceof TCProductType x) return put(tagged("product"),"types",array(x.types,z->type(z,false)));
    if(t instanceof TCUnionType x) return put(tagged("union"),"types",array(x.types,z->type(z,false)));
    if(t instanceof TCFunctionType x) { Obj j=tagged("function"); put(j,"partial",b(x.partial)); put(j,"params",array(x.parameters,z->type(z,false))); put(j,"result",type(x.result,false)); return j; }
    if(t instanceof TCOperationType x) { Obj j=tagged("operation"); put(j,"params",array(x.parameters,z->type(z,false))); put(j,"result",type(x.result,false)); return j; }
    String kind=switch(t) {
      case TCNaturalOneType x -> "nat1"; case TCNaturalType x -> "nat"; case TCIntegerType x -> "int";
      case TCRationalType x -> "rat"; case TCRealType x -> "real"; case TCBooleanType x -> "bool";
      case TCCharacterType x -> "char"; case TCTokenType x -> "token"; case TCVoidType x -> "void";
      case TCParameterType x -> "parameter"; case TCUnknownType x -> "unknown";
      default -> throw new IllegalArgumentException("Unsupported native type class "+t.getClass().getName());
    };
    Obj j=tagged(kind); if(t instanceof TCParameterType x) put(j,"name",s(x.name.getName())); return j;
  }
  static J param(TCPattern p,TCType t) {
    Obj x=obj(); put(x,"name",p instanceof TCIdentifierPattern i ? s(i.name.getName()):new Nil());
    put(x,"pattern",s(p.toString())); put(x,"names",array(p.getVariableNames(),z->s(z.getName()))); put(x,"type",type(t,false)); return x;
  }
  static J implicitParams(TCPatternListTypePairList ps) {
    List<J> out=new ArrayList<>(); for(var group:ps) for(var p:group.patterns) out.add(param(p,group.type)); return new Arr(out);
  }
  static J explicitParams(TCPatternList ps,TCTypeList ts) {
    List<J> out=new ArrayList<>(); for(int i=0;i<ps.size();i++) out.add(param(ps.get(i),ts.get(i))); return new Arr(out);
  }
  static J result(String name,TCType t) { Obj x=obj(); put(x,"name",s(name)); put(x,"type",type(t,false)); return x; }
  static class Facts extends TCVisitorSet<String,List<String>,Boolean> {
    final String module;
    final Set<String> reads=new TreeSet<>(), writes=new TreeSet<>(), fieldReads=new TreeSet<>(), references=new TreeSet<>();
    final List<LexLocation> imperative=new ArrayList<>();
    final Set<TCDefinition> components=Collections.newSetFromMap(new IdentityHashMap<>());
    Facts(String module) { this.module=module; }
    void expressions(ExpressionsVisitor visitor) { expressionVisitor=visitor; }
    protected List<String> newCollection() { return new ArrayList<>(); }
    protected void setVisitors() {
      expressionVisitor=new ExpressionsVisitor(this);
      statementVisitor=new StatementsVisitor(this);
      definitionVisitor=new DefinitionsVisitor(this);
      bindVisitor=new TCLeafBindVisitor<String,List<String>,Boolean>() {
        { visitorSet=Facts.this; }
        protected List<String> newCollection() { return new ArrayList<>(); }
        public List<String> caseBind(TCBind node,Boolean post) { return newCollection(); }
      };
      multiBindVisitor=new TCLeafMultipleBindVisitor<String,List<String>,Boolean>() {
        { visitorSet=Facts.this; }
        protected List<String> newCollection() { return new ArrayList<>(); }
        public List<String> caseMultipleBind(TCMultipleBind node,Boolean post) { return newCollection(); }
      };
      patternVisitor=new TCLeafPatternVisitor<String,List<String>,Boolean>() {
        { visitorSet=Facts.this; }
        protected List<String> newCollection() { return new ArrayList<>(); }
        public List<String> casePattern(TCPattern node,Boolean post) { return newCollection(); }
      };
      typeVisitor=new TCLeafTypeVisitor<String,List<String>,Boolean>() {
        protected List<String> newCollection() { return new ArrayList<>(); }
        public List<String> caseType(TCType node,Boolean post) { return newCollection(); }
        public List<String> caseNamedType(TCNamedType node,Boolean post) { reference(node.typename); return newCollection(); }
        public List<String> caseRecordType(TCRecordType node,Boolean post) {
          reference(node.name);
          return super.caseRecordType(node,post);
        }
      };
    }
    void reference(TCNameToken name) {
      if(name!=null && !name.getModule().equals(module)) references.add(name.getModule()+"`"+name.getName());
    }
    void fieldRead(TCType type,String field) {
      if(type instanceof TCNamedType named) fieldRead(named.type,field);
      else if(type instanceof TCBracketType bracket) fieldRead(bracket.type,field);
      else if(type instanceof TCUnionType union) for(TCType member:union.types) fieldRead(member,field);
      else if(type instanceof TCRecordType record && record.fields.stream().anyMatch(f->f.tag.equals(field)))
        fieldReads.add(record.name.getModule()+"`"+record.name.getName()+"."+field);
    }
    boolean state(TCDefinition definition) {
      if(definition==null) return false;
      definition=definition.deref();
      if(definition instanceof TCExternalDefinition external) definition=external.state.deref();
      return components.contains(definition);
    }
  }
  static class ExpressionsVisitor extends TCLeafExpressionVisitor<String,List<String>,Boolean> {
    final Facts facts;
    ExpressionsVisitor(Facts facts) { this.facts=facts; visitorSet=facts; }
    protected List<String> newCollection() { return new ArrayList<>(); }
    public List<String> caseExpression(TCExpression node,Boolean post) { return newCollection(); }
    public List<String> caseVariableExpression(TCVariableExpression node,Boolean post) {
      TCDefinition definition=node.getDefinition();
      if(definition!=null) facts.reference(definition.deref().name);
      if(facts.state(definition)) {
        (post && !node.name.isOld() ? facts.writes:facts.reads).add(node.name.getName());
      }
      return newCollection();
    }
    public List<String> caseFieldExpression(TCFieldExpression node,Boolean post) {
      facts.fieldRead(node.object.getType(),node.field.getName());
      return super.caseFieldExpression(node,post);
    }
    public List<String> caseMkTypeExpression(TCMkTypeExpression node,Boolean post) {
      facts.applyTypeVisitor(node.getType(),post); return super.caseMkTypeExpression(node,post);
    }
    public List<String> caseIsExpression(TCIsExpression node,Boolean post) {
      if(node.typedef!=null) facts.reference(node.typedef.deref().name);
      return super.caseIsExpression(node,post);
    }
    public List<String> caseNarrowExpression(TCNarrowExpression node,Boolean post) {
      facts.applyTypeVisitor(node.getType(),post); return super.caseNarrowExpression(node,post);
    }
  }
  static class StatementsVisitor extends TCLeafStatementVisitor<String,List<String>,Boolean> {
    final Facts facts;
    StatementsVisitor(Facts facts) { this.facts=facts; visitorSet=facts; }
    protected List<String> newCollection() { return new ArrayList<>(); }
    public List<String> caseStatement(TCStatement node,Boolean post) { return newCollection(); }
    void target(TCStateDesignator target) {
      if(target instanceof TCIdentifierDesignator identifier) {
        if(facts.state(identifier.getDefinition())) facts.writes.add(identifier.name.getName());
      } else if(target instanceof TCFieldDesignator field) {
        target(field.object);
      } else if(target instanceof TCMapSeqDesignator mapseq) {
        target(mapseq.mapseq); facts.applyExpressionVisitor(mapseq.exp,false);
      }
    }
    public List<String> caseAssignmentStatement(TCAssignmentStatement node,Boolean post) {
      facts.imperative.add(node.location); target(node.target);
      return super.caseAssignmentStatement(node,post);
    }
    public List<String> caseBlockStatement(TCBlockStatement node,Boolean post) {
      for(TCDefinition definition:node.assignmentDefs) facts.imperative.add(definition.location);
      return super.caseBlockStatement(node,post);
    }
    public List<String> caseWhileStatement(TCWhileStatement node,Boolean post) {
      facts.imperative.add(node.location); return super.caseWhileStatement(node,post);
    }
    public List<String> caseForAllStatement(TCForAllStatement node,Boolean post) {
      facts.imperative.add(node.location); return super.caseForAllStatement(node,post);
    }
    public List<String> caseForIndexStatement(TCForIndexStatement node,Boolean post) {
      facts.imperative.add(node.location); return super.caseForIndexStatement(node,post);
    }
    public List<String> caseForPatternBindStatement(TCForPatternBindStatement node,Boolean post) {
      facts.imperative.add(node.location); return super.caseForPatternBindStatement(node,post);
    }
    public List<String> caseCallStatement(TCCallStatement node,Boolean post) {
      TCDefinition definition=node.getDefinition();
      if(definition!=null) facts.reference(definition.deref().name);
      return super.caseCallStatement(node,post);
    }
  }
  static class DefinitionsVisitor extends TCLeafDefinitionVisitor<String,List<String>,Boolean> {
    DefinitionsVisitor(Facts facts) { visitorSet=facts; }
    protected List<String> newCollection() { return new ArrayList<>(); }
    public List<String> caseDefinition(TCDefinition node,Boolean post) { return newCollection(); }
  }
  static J externals(TCExternalClauseList clauses) {
    if(clauses==null) return new Nil();
    Set<String> rd=new TreeSet<>(), wr=new TreeSet<>();
    for(TCExternalClause clause:clauses) for(TCNameToken name:clause.identifiers)
      (clause.mode.is(Token.READ)?rd:wr).add(name.getName());
    return put(put(obj(),"rd",array(rd,Vdm::s)),"wr",array(wr,Vdm::s));
  }
  static void operation(Obj out,TCStatement body,TCExpression post,TCExternalClauseList clauses,String module,TCStateDefinition state) {
    Facts facts=new Facts(module);
    if(state!=null) for(TCDefinition component:state.statedefs)
      if(state.fields.stream().anyMatch(field->field.tag.equals(component.name.getName()))) facts.components.add(component);
    facts.applyStatementVisitor(body,false); facts.applyExpressionVisitor(post,true);
    put(out,"imperative",array(facts.imperative,Vdm::loc));
    put(out,"ext",externals(clauses)); put(out,"reads",array(facts.reads,Vdm::s)); put(out,"writes",array(facts.writes,Vdm::s));
  }
  static J initialValue(Value original) {
    Value value=original.deref();
    return switch(value) {
      case BooleanValue z -> put(tagged("bool"),"v",b(z.value));
      case IntegerValue z -> put(tagged("int"),"v",s(Long.toString(z.intValue(null))));
      case CharacterValue z -> put(tagged("char"),"v",s(String.valueOf(z.unicode)));
      case QuoteValue z -> put(tagged("quote"),"v",s(z.value));
      case NilValue z -> tagged("nil");
      case TokenValue z -> {
        try {
          // VDMJ TokenValue exposes no public accessor for its native payload.
          var payload=TokenValue.class.getDeclaredField("value"); payload.setAccessible(true);
          yield put(tagged("token"),"v",initialValue((Value)payload.get(z)));
        } catch(ReflectiveOperationException e) { throw new IllegalStateException("Cannot project native token payload",e); }
      }
      case SeqValue z -> put(tagged("seq"),"items",array(z.values,Vdm::initialValue));
      case SetValue z -> put(tagged("set"),"items",array(z.values,Vdm::initialValue));
      case TupleValue z -> put(tagged("tuple"),"items",array(z.values,Vdm::initialValue));
      case MapValue z -> put(tagged("map"),"entries",array(z.values.entrySet(),e->new Arr(List.of(initialValue(e.getKey()),initialValue(e.getValue())))));
      case RecordValue z -> {
        Obj out=tagged("record"); put(out,"module",s(z.type.name.getModule())); put(out,"name",s(z.type.name.getName()));
        yield put(out,"fields",array(z.fieldmap,f->put(put(obj(),"name",s(f.name)),"value",initialValue(f.value))));
      }
      default -> throw new IllegalArgumentException("Initial state contains unsupported native value "+value.getClass().getName());
    };
  }
  // Sampling evaluates predicates on generated values, and those evaluations abort (partial predicates). Run on
  // this thread, later QuickCheck reported FAILED with the bindings of a recursive measured function (B2 PO #14/#61;
  // fixture po-after-sampling). VDMJ's FunctionValue keys its measure state by thread id, so sampling runs on its own thread.
  static J sample(TCExplicitFunctionDefinition predicate,ModuleInterpreter interpreter,boolean invariant) {
    if(predicate==null || interpreter==null || !inSlice(predicate.name.getModule())) return new Nil();
    J[] result=new J[1]; RuntimeException[] failure=new RuntimeException[1];
    Thread worker=new Thread(()->{ try { result[0]=sampleOnThread(predicate,interpreter,invariant); } catch(RuntimeException e) { failure[0]=e; } },"ssot-sample");
    worker.start();
    try { worker.join(); } catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException("Sampling "+predicate.name+" interrupted",e); }
    if(failure[0]!=null) throw failure[0];
    return result[0];
  }
  /** At most 128 combinations of at most 8 values per parameter: bounded by count, not by wall clock, so the counts do not depend on machine load. */
  static J sampleOnThread(TCExplicitFunctionDefinition predicate,ModuleInterpreter interpreter,boolean invariant) {
    int yes=0,no=0;
    boolean invchecks=Settings.invchecks;
    try {
      interpreter.setDefaultName(predicate.name.getModule());
      Context context=new StateContext(predicate.location,"ssot predicate sample",interpreter.getInitialContext(),interpreter.getStateContext());
      context.setThreadState(null); context.threadState.init();
      INExplicitFunctionDefinition executable=ClassMapper.getInstance(INNode.MAPPINGS).convertLocal(predicate);
      FunctionValue function=new FunctionValue(executable,null,null,null);
      List<ValueSet> ranges=new ArrayList<>();
      List<Integer> groups=new ArrayList<>();
      TCFunctionType groupType=predicate.type;
      for(int group=0;group<predicate.paramPatternList.size();group++) {
        groups.add(groupType.parameters.size());
        for(TCType parameter:groupType.parameters) {
          TCType domain=invariant && parameter instanceof TCNamedType named?named.type:parameter;
          if(invariant) Settings.invchecks=false;
          ValueSet range=domain.apply(new FixedRangeCreator(context),8);
          if(range.isEmpty()) return new Nil();
          ranges.add(range);
        }
        if(group+1<predicate.paramPatternList.size()) groupType=(TCFunctionType)groupType.result;
      }
      int[] indices=new int[ranges.size()];
      for(int count=0;count<128;count++) {
        try {
          Value evaluated=function; int offset=0;
          for(int size:groups) {
            ValueList args=new ValueList(size);
            for(int i=0;i<size;i++,offset++) args.add(ranges.get(offset).get(indices[offset]));
            evaluated=evaluated.functionValue(context).eval(predicate.location,args,context);
          }
          if(evaluated.boolValue(context)) yes++; else no++;
        } catch(ContextException | ValueException e) {
          // Partial predicates may be undefined for a candidate; only actual boolean results count.
        }
        int i=indices.length-1;
        while(i>=0 && ++indices[i]>=ranges.get(i).size()) { indices[i]=0; i--; }
        if(i<0) break;
      }
    } catch(Exception e) {
      if(!(e instanceof ContextException) && !(e instanceof ValueException) && !(e instanceof UnsupportedOperationException))
        throw new IllegalStateException("Sampling "+predicate.name+" failed",e);
    } finally {
      Settings.invchecks=invchecks;
    }
    return yes+no==0?new Nil():put(put(obj(),"trueCount",n(yes)),"falseCount",n(no));
  }
  static J invariantReads(TCStateDefinition state) {
    Set<String> reads=new TreeSet<>();
    if(state.invExpression==null) return array(reads,Vdm::s);
    if(state.invPattern instanceof TCRecordPattern record) {
      var used=state.invExpression.getVariableNames();
      for(int i=0;i<record.plist.size();i++)
        for(TCNameToken name:record.plist.get(i).getVariableNames())
          if(used.contains(name)) reads.add(state.fields.get(i).tag);
    } else if(state.invPattern instanceof TCIdentifierPattern identifier) {
      Facts facts=new Facts(state.name.getModule());
      facts.expressions(new ExpressionsVisitor(facts) {
        public List<String> caseVariableExpression(TCVariableExpression node,Boolean post) {
          if(node.name.equals(identifier.name)) for(TCField field:state.fields) reads.add(field.tag);
          return super.caseVariableExpression(node,post);
        }
        public List<String> caseFieldExpression(TCFieldExpression node,Boolean post) {
          if(node.object instanceof TCVariableExpression variable && variable.name.equals(identifier.name)) {
            reads.add(node.field.getName()); return newCollection();
          }
          return super.caseFieldExpression(node,post);
        }
      });
      facts.applyExpressionVisitor(state.invExpression,false);
    }
    return array(reads,Vdm::s);
  }
  static J definition(TCDefinition d,ModuleInterpreter interpreter,List<J> messages) {
    Obj x=obj(); put(x,"name",d.name==null?new Nil():s(d.name.getName())); put(x,"location",loc(d.location));
    if(d instanceof TCTypeDefinition z) {
      put(x,"category",s("type")); put(x,"type",type(z.type,true)); put(x,"hasInvariant",b(z.invExpression!=null));
      put(x,"invSample",sample(z.invdef,interpreter,true));
    }
    else if(d instanceof TCStateDefinition z) {
      put(x,"category",s("state")); put(x,"fields",fields(z.fields)); put(x,"hasInvariant",b(z.invExpression!=null)); put(x,"hasInit",b(z.initExpression!=null));
      put(x,"invReads",invariantReads(z)); put(x,"initial",new Nil());
      if(interpreter!=null) try {
        interpreter.setDefaultName(z.name.getModule());
        put(x,"initial",initialValue(interpreter.getStateContext().lookup(z.name)));
      } catch(Exception e) {
        messages.add(diagnostic(new VDMError(0,"Cannot project initialized state: "+e.getMessage(),z.location),"error"));
      }
    }
    else if(d instanceof TCValueDefinition z) { put(x,"category",s("value")); put(x,"pattern",s(z.pattern.toString())); put(x,"names",array(z.pattern.getVariableNames(),a->s(a.getName()))); put(x,"type",type(z.getType(),false)); put(x,"expression",s(z.exp.toString())); }
    else if(d instanceof TCImplicitOperationDefinition z) {
      callable(x,"operation","implicit",implicitParams(z.parameterPatterns),z.result==null?result(null,z.type.result):param(z.result.pattern,z.result.type),z.precondition!=null,z.postcondition!=null);
      put(x,"preType",z.predef==null?new Nil():type(z.predef.type,false)); put(x,"postType",z.postdef==null?new Nil():type(z.postdef.type,false));
      operation(x,z.body,z.postcondition,z.externals,z.name.getModule(),z.stateDefinition); put(x,"preSample",sample(z.predef,interpreter,false));
    }
    else if(d instanceof TCExplicitOperationDefinition z) {
      callable(x,"operation","explicit",explicitParams(z.parameterPatterns,z.type.parameters),result("RESULT",z.type.result),z.precondition!=null,z.postcondition!=null);
      put(x,"preType",z.predef==null?new Nil():type(z.predef.type,false)); put(x,"postType",z.postdef==null?new Nil():type(z.postdef.type,false));
      operation(x,z.body,z.postcondition,null,z.name.getModule(),z.stateDefinition); put(x,"preSample",sample(z.predef,interpreter,false));
    }
    else if(d instanceof TCImplicitFunctionDefinition z) {
      callable(x,"function","implicit",implicitParams(z.parameterPatterns),param(z.result.pattern,z.result.type),z.precondition!=null,z.postcondition!=null);
      put(x,"preSample",sample(z.predef,interpreter,false));
    }
    else if(d instanceof TCExplicitFunctionDefinition z) {
      List<J> groups=new ArrayList<>(); TCFunctionType ft=z.type;
      for(int i=0;i<z.paramPatternList.size();i++) { groups.add(explicitParams(z.paramPatternList.get(i),ft.parameters)); if(i+1<z.paramPatternList.size()) ft=(TCFunctionType)ft.result; }
      List<J> flat=new ArrayList<>(); for(J group:groups) flat.addAll(((Arr)group).items);
      callable(x,"function","explicit",new Arr(flat),result("RESULT",ft.result),z.precondition!=null,z.postcondition!=null); put(x,"paramGroups",new Arr(groups));
      put(x,"preSample",sample(z.predef,interpreter,false));
    }
    else { put(x,"category",s(d.kind())); put(x,"nativeClass",s(d.getClass().getName())); }
    return x;
  }
  static void callable(Obj x,String category,String kind,J params,J result,boolean pre,boolean post) {
    put(x,"category",s(category)); put(x,"kind",s(kind)); put(x,"params",params); put(x,"result",result); put(x,"hasPre",b(pre)); put(x,"hasPost",b(post));
    put(x,"imperative",new Arr(List.of())); put(x,"preSample",new Nil()); put(x,"ext",new Nil());
    put(x,"reads",new Arr(List.of())); put(x,"writes",new Arr(List.of()));
  }
  static J module(TCModule m,ModuleInterpreter interpreter,List<J> messages) {
    Obj x=obj(); put(x,"name",s(m.name.getName())); put(x,"file",s(m.name.getLocation().file.getPath())); put(x,"location",loc(m.name.getLocation()));
    List<J> imports=new ArrayList<>(); if(m.imports!=null) for(var from:m.imports.imports) {
      Obj z=obj(); put(z,"module",s(from.name.getName())); put(z,"items",array(from.signatures,i->{
        String kind=switch(i) { case TCImportAll a -> "all"; case TCImportedType a -> "type"; case TCImportedOperation a -> "operation"; case TCImportedFunction a -> "function"; case TCImportedValue a -> "value"; default -> throw new IllegalArgumentException(i.getClass().getName()); };
        Obj j=tagged(kind); put(j,"name",i instanceof TCImportAll?new Nil():s(i.name.getName())); put(j,"renamed",i.renamed==null?new Nil():s(i.renamed.getName())); return j;
      })); imports.add(z);
    } put(x,"imports",new Arr(imports));
    List<J> exports=new ArrayList<>(); if(m.exports!=null) for(var e:m.exports.exports) {
      if(e instanceof TCExportAll) exports.add(tagged("all"));
      else if(e instanceof TCExportedType t) { Obj j=tagged("type"); put(j,"name",s(t.name.getName())); put(j,"struct",b(t.struct)); exports.add(j); }
      else { var names=switch(e) { case TCExportedFunction z -> z.nameList; case TCExportedOperation z -> z.nameList; case TCExportedValue z -> z.nameList; default -> throw new IllegalArgumentException(e.getClass().getName()); };
        String kind=e instanceof TCExportedFunction?"function":e instanceof TCExportedOperation?"operation":"value";
        for(var name:names) exports.add(put(tagged(kind),"name",s(name.getName())));
      }
    } put(x,"exports",new Arr(exports)); put(x,"definitions",array(m.defs,d->definition(d,interpreter,messages)));
    Facts facts=new Facts(m.name.getName());
    for(TCDefinition definition:m.defs) {
      facts.applyDefinitionVisitor(definition,false);
      facts.applyTypeVisitor(definition instanceof TCTypeDefinition type && type.type instanceof TCNamedType named?named.type:definition.getType(),false);
    }
    put(x,"fieldReads",array(facts.fieldReads,Vdm::s)); put(x,"references",array(facts.references,Vdm::s));
    return x;
  }
  static J value(Value original) {
    Value v=original.deref(); Obj x=tagged(v.kind()); put(x,"text",s(v.toString()));
    switch(v) {
      case BooleanValue z -> put(x,"value",b(z.value));
      case CharacterValue z -> put(x,"value",s(String.valueOf(z.unicode)));
      case QuoteValue z -> put(x,"value",s(z.value));
      case NumericValue z -> put(x,"decimal",s(z.toString()));
      case SeqValue z -> put(x,"items",array(z.values,Vdm::value));
      case SetValue z -> put(x,"items",array(z.values,Vdm::value));
      case TupleValue z -> put(x,"items",array(z.values,Vdm::value));
      case MapValue z -> put(x,"entries",array(z.values.entrySet(),entry->{ Obj j=obj(); put(j,"key",value(entry.getKey())); put(j,"value",value(entry.getValue())); return j; }));
      case RecordValue z -> { put(x,"module",s(z.type.name.getModule())); put(x,"name",s(z.type.name.getName())); put(x,"fields",array(z.fieldmap,f->{ Obj j=obj(); put(j,"name",s(f.name)); put(j,"value",value(f.value)); return j; })); }
      default -> {} // Token/function/operation/undefined/nil retain native kind and exact value text.
    }
    return x;
  }
  // Strict JSON input: an array of string arrays [module, expression, (name, module, expression, typeModule, typeName)*];
  // no third-party JSON library required. The trailing groups are typed bindings (see Bind).
  static class Expressions {
    final String text; int at=0;
    Expressions(String text) { this.text=text; }
    void ws() { while(at<text.length() && Character.isWhitespace(text.charAt(at))) at++; }
    void expect(char c) { ws(); if(at>=text.length() || text.charAt(at++)!=c) throw new IllegalArgumentException("Expected JSON '"+c+"' at "+at); }
    String string() {
      expect('"'); StringBuilder out=new StringBuilder();
      while(at<text.length()) { char c=text.charAt(at++); if(c=='"') return out.toString();
        if(c=='\\') { if(at>=text.length()) throw new IllegalArgumentException("Truncated escape"); char e=text.charAt(at++);
          switch(e) { case '"','\\','/' -> out.append(e); case 'b' -> out.append('\b'); case 'f' -> out.append('\f'); case 'n' -> out.append('\n'); case 'r' -> out.append('\r'); case 't' -> out.append('\t'); case 'u' -> { if(at+4>text.length()) throw new IllegalArgumentException("Truncated unicode escape"); out.append((char)Integer.parseInt(text.substring(at,at+4),16)); at+=4; } default -> throw new IllegalArgumentException("Invalid JSON escape"); }
        } else { if(c<32) throw new IllegalArgumentException("Unescaped JSON control character"); out.append(c); }
      } throw new IllegalArgumentException("Unterminated JSON string");
    }
    List<String[]> parse() {
      List<String[]> out=new ArrayList<>(); expect('['); ws();
      if(at<text.length() && text.charAt(at)==']') at++;
      else while(true) {
        expect('['); List<String> row=new ArrayList<>(); row.add(string());
        while(true) { ws(); if(at<text.length() && text.charAt(at)==']') { at++; break; } expect(','); row.add(string()); }
        if(row.size()<2 || (row.size()-2)%5!=0) throw new IllegalArgumentException("Bad item arity "+row.size());
        out.add(row.toArray(String[]::new)); ws();
        if(at<text.length() && text.charAt(at)==']') { at++; break; } expect(',');
      }
      ws(); if(at!=text.length()) throw new IllegalArgumentException("Trailing JSON input"); return out;
    }
  }
  /**
   * A value of a type that the evaluating module may only see opaquely: built by evaluating `expr` in `module`
   * (its defining module or the module exporting its constructor), then bound as `name` with the type
   * `typeModule`TypeName as that type is visible in the module where it is used. Nothing in the specification changes.
   */
  record Bind(String name, String module, String expr, String typeModule, String typeName) {}
  /**
   * Type definitions of every module, by qualified name. Replay renders trace values as `mk_M`T(...)`; a value nested in an
   * argument may have a record type the evaluating module never imports (it only imports the enclosing type). Visibility is
   * a property of the specification text, not of a concrete value, so qualified type names resolve against every module.
   */
  static TCDefinitionList allTypes=new TCDefinitionList();
  /** Parse, typecheck (throwing) and evaluate `source` in `module`, with `binds` declared as typed local names. */
  static Value checked(ModuleInterpreter it, String module, String source, List<Bind> binds, Map<String,Value> values) throws Exception {
    it.setDefaultName(module);
    Environment env=new FlatEnvironment(allTypes,it.getGlobalEnvironment());
    StateContext ctx=new StateContext(LexLocation.ANY,"ssot replay",it.getInitialContext(),it.getStateContext());
    ctx.setThreadState(null);
    TCDefinitionList defs=new TCDefinitionList();
    for(Bind b:binds) {
      TCNameToken name=new TCNameToken(LexLocation.ANY,module,b.name());
      TCDefinition td=env.findType(new TCNameToken(LexLocation.ANY,b.typeModule(),b.typeName()),module);
      if(td==null) throw new IllegalArgumentException("Type "+b.typeModule()+"`"+b.typeName()+" is not visible in module "+module);
      TCType type=td.getType();
      defs.add(new TCLocalDefinition(LexLocation.ANY,name,type));
      ctx.put(name,values.get(b.name()).convertTo(type,ctx));
    }
    if(!defs.isEmpty()) env=new FlatEnvironment(defs,env);
    LexTokenReader lexer=new LexTokenReader(source,Dialect.VDM_SL);
    ExpressionReader reader=new ExpressionReader(lexer);
    try {
      reader.setCurrentModule(module);
      TCExpression expression=ClassMapper.getInstance(TCNode.MAPPINGS).convertLocal(reader.readExpression());
      if(!lexer.getLast().is(Token.EOF)) throw new IllegalArgumentException("Trailing expression input");
      it.typeCheck(expression,env);
      INExpression executable=ClassMapper.getInstance(INNode.MAPPINGS).convertLocal(expression);
      ctx.threadState.init();
      return executable.eval(ctx);
    } finally { reader.close(); }
  }
  static double ms(long start) { return (System.nanoTime()-start)/1_000_000.0; }
  /** Modules whose predicates are sampled and whose obligations QuickCheck checks; null means every module. */
  static Set<String> checkModules=null;
  static boolean inSlice(String module) { return checkModules==null || checkModules.contains(module); }
  static J obligations(TCModuleList tc) throws Exception {
    POModuleList modules=ClassMapper.getInstance(PONode.MAPPINGS).init().convert(tc);
    ProofObligationList obligations=modules.getProofObligations();
    obligations.renumber();
    // --scope: QuickCheck only the obligations of the slice's modules; numbering stays that of the whole project.
    if(checkModules!=null) obligations.removeIf(p->!inSlice(p.location.module));
    if(!obligations.isEmpty()) {
      QCConsole.setQuiet(true); QCConsole.setVerbose(false);
      QuickCheck qc=new QuickCheck();
      List<String> options=new ArrayList<>(List.of("-finite:size","1024","-fixed:size","20"));
      qc.loadStrategies(options);
      if(qc.hasErrors() || !options.isEmpty()) throw new IllegalStateException("QuickCheck strategies failed to load");
      ProofObligationList chosen=qc.getPOs(obligations,List.of(),List.of(".*"));
      if(qc.hasErrors() || !qc.initStrategies()) throw new IllegalStateException("QuickCheck initialization failed");
      // No wall-clock limit: each obligation is bounded by the strategy sizes above, so its status does not depend on machine load.
      for(ProofObligation p:chosen) {
        if(!p.isCheckable) continue;
        qc.resetErrors();
        var values=qc.getValues(p);
        if(qc.hasErrors()) p.markUnchecked("QuickCheck could not generate bindings");
        else qc.checkObligation(p,values);
      }
    }
    return array(obligations,p->{
      Obj x=obj(); put(x,"number",n(p.number)); put(x,"kind",s(p.kind.name())); put(x,"name",s(p.name));
      put(x,"module",s(p.location.module)); put(x,"location",loc(p.location)); put(x,"expression",s(p.getSource()));
      put(x,"status",s(p.status.name())); put(x,"checkable",b(p.isCheckable)); put(x,"message",s(p.message)); put(x,"qualifier",s(p.qualifier));
      Obj bindings=obj();
      if(p.counterexample!=null) p.counterexample.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e->put(bindings,e.getKey().toString(),s(e.getValue().toString())));
      put(x,"counterexample",bindings); return x;
    });
  }
  static J run(String[] args) throws Exception {
    if(args.length<2) throw new IllegalArgumentException("Usage: Vdm.java project|obligations [--check=m1,m2] files... OR eval files... < [[module, expression], ...]");
    String cmd=args[0]; if(!Set.of("project","obligations","eval").contains(cmd)) throw new IllegalArgumentException("Unknown subcommand "+cmd);
    int first=1;
    if(args[1].startsWith("--check=")) {
      String list=args[1].substring("--check=".length());
      checkModules=list.isEmpty()?Set.of():Set.of(list.split(","));
      first=2;
    }
    long total=System.nanoTime(), parseStart=total;
    Settings.dialect=Dialect.VDM_SL; Settings.prechecks=true; Settings.postchecks=true; Settings.invchecks=true; Settings.dynamictypechecks=true;
    ASTModuleList ast=new ASTModuleList(); List<J> parseMessages=new ArrayList<>(); boolean parseFailed=false;
    for(int i=first;i<args.length;i++) {
      ModuleReader reader=new ModuleReader(new LexTokenReader(new File(args[i]),Dialect.VDM_SL));
      try { ast.addAll(reader.readModules()); parseMessages.addAll(((Arr)diagnostics(reader.getErrors(),reader.getWarnings())).items); parseFailed|=reader.getErrorCount()>0; }
      finally { reader.close(); }
    }
    Obj out=obj(); put(out,"command",s(cmd)); put(out,"parseDiagnostics",new Arr(parseMessages)); put(out,"parseMs",n(ms(parseStart)));
    if(parseFailed) { put(out,"ok",b(false)); put(out,"typecheckDiagnostics",new Arr(List.of())); put(out,"typecheckSkipped",b(true)); return out; }
    long checkStart=System.nanoTime(); TypeChecker.clearErrors();
    TCModuleList tc=ClassMapper.getInstance(TCNode.MAPPINGS).init().convert(ast); tc.combineDefaults(); new ModuleTypeChecker(tc).typeCheck();
    put(out,"typecheckDiagnostics",diagnostics(TypeChecker.getErrors(),TypeChecker.getWarnings())); put(out,"typecheckMs",n(ms(checkStart)));
    boolean ok=TypeChecker.getErrorCount()==0; put(out,"ok",b(ok));
    if(ok && cmd.equals("project")) {
      List<J> projectionMessages=new ArrayList<>(((Arr)out.fields.get("typecheckDiagnostics")).items);
      ModuleInterpreter interpreter=null;
      try {
        INModuleList in=ClassMapper.getInstance(INNode.MAPPINGS).init().convert(tc);
        interpreter=new ModuleInterpreter(in,tc); interpreter.init();
      } catch(Exception e) {
        LexLocation location=e instanceof ContextException c?c.location:tc.get(0).name.getLocation();
        projectionMessages.add(diagnostic(new VDMError(0,"Cannot initialize contract state: "+e.getMessage(),location),"error"));
        interpreter=null;
      }
      ModuleInterpreter initialized=interpreter;
      put(out,"modules",array(tc,m->module(m,initialized,projectionMessages)));
      put(out,"typecheckDiagnostics",new Arr(projectionMessages));
    }
    // QuickCheck runs in its own process so the caller can overlap it with behaviour simulation; contract projection does not need it.
    // An uninitialisable state has no obligations to check; the project subcommand reports why.
    if(ok && cmd.equals("obligations")) {
      ModuleInterpreter interpreter;
      try {
        INModuleList in=ClassMapper.getInstance(INNode.MAPPINGS).init().convert(tc);
        interpreter=new ModuleInterpreter(in,tc); interpreter.init();
      } catch(Exception e) { interpreter=null; }
      if(interpreter!=null) interpreter.setDefaultName(tc.get(0).name.getName());
      long poStart=System.nanoTime();
      put(out,"proofObligations",interpreter==null?new Arr(List.of()):obligations(tc)); put(out,"poMs",n(ms(poStart)));
      put(out,"poDiagnostics",diagnostics(TypeChecker.getErrors(),TypeChecker.getWarnings()));
    }
    if(ok && cmd.equals("eval")) {
      List<String[]> items=new Expressions(new String(System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).parse();
      long initStart=System.nanoTime(); INModuleList in=ClassMapper.getInstance(INNode.MAPPINGS).init().convert(tc);
      ModuleInterpreter interpreter=new ModuleInterpreter(in,tc); interpreter.init();
      for(TCModule m:tc) for(TCDefinition d:m.defs) if(d instanceof TCTypeDefinition || d instanceof TCStateDefinition) allTypes.add(d);
      put(out,"initMs",n(ms(initStart))); long evalStart=System.nanoTime();
      Map<String,Value> cache=new HashMap<>();
      List<J> results=new ArrayList<>(); for(String[] item:items) {
        Obj x=obj(); put(x,"module",s(item[0])); put(x,"expression",s(item[1])); long one=System.nanoTime();
        try {
          // Bindings are evaluated in order; each may use the earlier ones. Identical constructions are evaluated once.
          List<Bind> binds=new ArrayList<>(); Map<String,Value> values=new HashMap<>();
          for(int i=2;i<item.length;i+=5) {
            Bind b=new Bind(item[i],item[i+1],item[i+2],item[i+3],item[i+4]);
            String key=b.module()+"\u0000"+b.expr();
            Value v=cache.get(key);
            if(v==null) { v=checked(interpreter,b.module(),b.expr(),binds,values); cache.put(key,v); }
            values.put(b.name(),v); binds.add(b);
          }
          Value v=checked(interpreter,item[0],item[1],binds,values);
          put(x,"kind",s("value")); put(x,"text",s(v.toString())); put(x,"value",value(v));
        }
        catch(Exception e) { x.fields.putAll(((Obj)error(e)).fields); }
        put(x,"ms",n(ms(one))); results.add(x);
      }
      put(out,"results",new Arr(results)); put(out,"evalMs",n(ms(evalStart))); put(out,"count",n(results.size()));
    }
    put(out,"totalMs",n(ms(total))); return out;
  }
  static void quote(StringBuilder out,String text) {
    out.append('"'); for(int i=0;i<text.length();i++) { char c=text.charAt(i); switch(c) {
      case '"' -> out.append("\\\""); case '\\' -> out.append("\\\\"); case '\n' -> out.append("\\n"); case '\r' -> out.append("\\r"); case '\t' -> out.append("\\t");
      default -> { if(c<32) out.append(String.format("\\u%04x",(int)c)); else out.append(c); }
    }} out.append('"');
  }
  static void json(StringBuilder out,J j) {
    switch(j) {
      case Nil x -> out.append("null"); case Str x -> quote(out,x.value); case Num x -> out.append(x.value); case Bool x -> out.append(x.value);
      case Arr x -> { out.append('['); boolean first=true; for(J a:x.items) { if(!first) out.append(','); first=false; json(out,a); } out.append(']'); }
      case Obj x -> { out.append('{'); boolean first=true; for(var e:x.fields.entrySet()) { if(!first) out.append(','); first=false; quote(out,e.getKey()); out.append(':'); json(out,e.getValue()); } out.append('}'); }
    }
  }
  public static void main(String[] args) {
    PrintStream stdout=System.out; System.setOut(System.err);
    J result; try { result=run(args); } catch(Exception e) { result=error(e); }
    StringBuilder out=new StringBuilder(); json(out,result); stdout.println(out);
  }
}
