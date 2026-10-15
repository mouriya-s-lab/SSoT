import com.fujitsu.vdmj.Settings;
import com.fujitsu.vdmj.ast.definitions.ASTDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTStateDefinition;
import com.fujitsu.vdmj.ast.definitions.ASTTypeDefinition;
import com.fujitsu.vdmj.ast.modules.ASTImportFromModule;
import com.fujitsu.vdmj.ast.modules.ASTModule;
import com.fujitsu.vdmj.ast.types.ASTField;
import com.fujitsu.vdmj.ast.types.ASTFieldList;
import com.fujitsu.vdmj.ast.types.ASTRecordType;
import com.fujitsu.vdmj.lex.Dialect;
import com.fujitsu.vdmj.lex.LexTokenReader;
import com.fujitsu.vdmj.messages.VDMError;
import com.fujitsu.vdmj.syntax.ModuleReader;
import java.io.File;

/** Prints the module outline of literate VDM-SL files as JSON, using the VDMJ parser. */
public class Outline {
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
          out.append("{\"name\":").append(str(def.name == null ? def.toString() : def.name.name))
            .append(",\"kind\":").append(str(def.kind()))
            .append(",\"line\":").append(def.location.startLine)
            .append(",\"commented\":").append(def.comments != null && !def.comments.isEmpty())
            .append(",\"fields\":[");
          fields(out, fieldsOf(def));
          out.append("]}");
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
