# Local VDM Reference Documents

| File | Use | Original title | Exact original source |
|---|---|---|---|
| [language-manual.md](language-manual.md) | Look up the syntax and semantics of VDM-SL, VDM++ and VDM-RT, including the complete grammar, lexical rules and operator precedence. | VDM-10 Language Manual | https://github.com/overturetool/documentation/blob/editing/documentation/VDM10LangMan/VDM10_lang_man.tex |
| [operators.md](operators.md) | Look up operator signatures and compact examples. | Quick Overview of VDM Operators | https://github.com/overturetool/documentation/blob/editing/documentation/QuickOverviewVDMPPOperators/QuickOverviewofVDMOperators.tex ; included operator tables: https://github.com/overturetool/documentation/blob/editing/documentation/QuickOverviewVDMPPOperators/QuickOverviewVDM.tex ; included class example: https://github.com/overturetool/documentation/blob/editing/documentation/QuickOverviewVDMPPOperators/ClassExample.vpp |
| [messages.md](messages.md) | Look up numbered internal, lexical, syntax, type checking and runtime errors and warnings; a separate, non-exhaustive source supplement covers catalog omissions. | VDMJ Error and Warning Messages | https://github.com/overturetool/documentation/blob/editing/documentation/UserGuideVDMVSCode/MESSAGES_Internal.tex ; https://github.com/overturetool/documentation/blob/editing/documentation/UserGuideVDMVSCode/MESSAGES_Lexical.tex ; https://github.com/overturetool/documentation/blob/editing/documentation/UserGuideVDMVSCode/MESSAGES_Syntax.tex ; https://github.com/overturetool/documentation/blob/editing/documentation/UserGuideVDMVSCode/MESSAGES_TypeChecking.tex ; https://github.com/overturetool/documentation/blob/editing/documentation/UserGuideVDMVSCode/MESSAGES_Runtime.tex ; https://github.com/overturetool/documentation/blob/editing/documentation/UserGuideVDMVSCode/MESSAGES_Warnings.tex ; source supplement: https://github.com/nickbattle/vdmj/blob/master/vdmj/src/main/java/com/fujitsu/vdmj/typechecker/TypeComparator.java#L1164 |
| [vdmj-user-guide.md](vdmj-user-guide.md) | Use the VDMJ command line, interpreter, debugger, proof obligations, testing, annotations and configuration. | VDMJ Tool Support: User Guide | https://github.com/nickbattle/vdmj/blob/master/vdmj/documentation/UserGuide.pdf |
| [external-formats.md](external-formats.md) | Read and implement external-format readers, including LaTeX/literate source extraction and file associations. | External Format Reader Guide | https://github.com/nickbattle/vdmj/blob/master/vdmj/documentation/ExternalFormatGuide.pdf |
| [quickcheck.md](quickcheck.md) | Use QuickCheck to find proof-obligation counterexamples, understand result statuses, select obligations, configure timeouts and bind polymorphic types. | Using QuickCheck | https://github.com/nickbattle/vdmj/wiki/Using-QuickCheck ; original Markdown: https://raw.githubusercontent.com/wiki/nickbattle/vdmj/Using-QuickCheck.md |

The QuickCheck source is the user-facing wiki document, not the implementation design specification. GitHub wiki pages have canonical `/wiki/` URLs rather than repository `/blob/` URLs; the actual wiki URL is retained instead of inventing a repository path.

## Language-manual inputs

The language manual includes these semantic descriptions in their original positions:

- https://github.com/overturetool/documentation/blob/editing/documentation/VDM10LangMan/sem-numtypes.tex
- https://github.com/overturetool/documentation/blob/editing/documentation/VDM10LangMan/sem-settypes.tex
- https://github.com/overturetool/documentation/blob/editing/documentation/VDM10LangMan/sem-seqtypes.tex
- https://github.com/overturetool/documentation/blob/editing/documentation/VDM10LangMan/sem-maptypes.tex
- https://github.com/overturetool/documentation/blob/editing/documentation/VDM10LangMan/sem-comtypes.tex
- https://github.com/overturetool/documentation/blob/editing/documentation/VDM10LangMan/sem-functypes.tex

Custom notation is expanded from the original manual definitions and https://github.com/overturetool/documentation/blob/editing/documentation/VDM10LangMan/vdmsl-2e.sty ; listing syntax is defined by https://github.com/overturetool/documentation/blob/editing/documentation/VDM10LangMan/customlangdef.tex . The generated bibliography is taken from the matching published manual: https://github.com/overturetool/documentation/blob/editing/documentation/VDM10LangMan/VDM10_lang_man.pdf . Original figures are embedded in the Markdown files, so they do not require separate local image files.

## Licenses

- **overturetool/documentation:** no repository-wide license is declared in the `editing` branch. The root directory has no `LICENSE` or `LICENCE` file, and GitHub's repository-license API returns HTTP 404. Do not infer a license from another Overture repository or from a license belonging to an example subdirectory. Sources: https://github.com/overturetool/documentation/tree/editing and https://api.github.com/repos/overturetool/documentation/license .
- **nickbattle/vdmj:** the root [LICENCE](https://github.com/nickbattle/vdmj/blob/master/LICENCE), read through the GitHub API, contains the **GNU General Public License, Version 3**. Source files explicitly apply **GPL-3.0-or-later**, for example https://github.com/nickbattle/vdmj/blob/master/quickcheck/src/main/java/quickcheck/QuickCheck.java#L9-L21 .
- **VDMJ PDF documentation:** the User Guide and External Format Reader Guide separately grant **GNU Free Documentation License, Version 1.3 or any later version**, with no Invariant Sections, no Front-Cover Texts and no Back-Cover Texts. Their original copyright and license paragraphs are retained in the converted documents. The QuickCheck wiki page does not contain a separate license notice; no PDF-specific license is imputed to that wiki page.
