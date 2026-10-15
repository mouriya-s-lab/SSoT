Using QuickCheck
https://github.com/nickbattle/vdmj/wiki/Using-QuickCheck

_So QuickCheck sounds like something that won't take long to explain?_

**Well, the basics are pretty quick yes, but the name really means that checks are performed quickly.**

_Okay, so what checks are we talking about here?_

**Do you remember we talked about _proof obligations_, sometimes called "POs"?**

_Right, but... why don't you give me an example?_

**We'll need an example to work with anyway, so let start with something simple. Imagine you had this very small specification, with just one function:**
```vdm
functions
    f: seq of nat * nat -> nat
    f(s, i) == s(i);
```
_That's pretty small. But it's also pointless, surely? Calling `f(s, i)` is just the same as using `s(i)`?_

**Yes, it's just a simple example to show you how QuickCheck works. As you say, all this function does is return the i'th element of the sequence passed in. So can you see anything wrong with this spec?**

_Well... not really. I mean, it just returns the i'th element. It looks fine._

**So what would happen if I passed an empty sequence?**

_Ah._

**Or if I passed a valid sequence, but an index of zero or one beyond the end of the sequence?**

_Right, it would fail in those cases. But why doesn't VDMJ tell me about this?_

**Well, the spec "isn't wrong" -- it works perfectly if you use the function as intended. But if you aren't careful, there are problems. So really, VDMJ is saying that this is perfectly acceptable, BUT you have an obligation to call the function with sensible arguments.**

_That's quite a big BUT there. We're building formally defined systems, so we can't depend on callers "being careful", surely?_

**Absolutely not. So VDMJ can tell you about this problem.**

_I thought you just said it couldn't?_

**The default parse and typecheck doesn't raise this issue, because as I said, it "isn't wrong". But there is another level of checking that VDMJ can give you. In cases like this, it can produce _proof obligations_ that effectively define what callers of this function must guarantee.**

_You've mentioned the Proof Obligation Generator before, I remember._

**That's the one.**

_So what does a proof obligation look like?_

**Let's try with the example. You generate POs with the "pog" command:**
```vdm
> pog
Generated 1 proof obligation:

Proof Obligation 1: (Unproved)
f: sequence apply obligation in 'DEFAULT' (test.vdm) at line 3:16
(forall s:seq of (nat), i:nat &
  i in set inds s)
```
_Alright, hold on... that's just a VDM-SL expression?_

**We like to eat our own dogfood. But can you see what it's saying?**

_So it's a boolean expression for a start..._

**True.**

_And it's saying that for every possible `seq of nat` and every possible `nat`, the latter is a valid index of the former. Okay, so yes, this is saying that every number is a valid index of every sequence... but that's rubbish, surely?_

**Or "false", yes. There are _some_ sequences and natural numbers that work together, but it isn't generally true for all sequences and numbers.**

_So, hold on. This "PO" is just a VDM expression. I can see how it relates to the spec, but it doesn't call `f` to test it?_

**Right. It isn't like a unit test. It's an _obligation on you_ that follows from the way you've written the function. So you must _prove_ that this obligation is met -- sometimes we use the term "discharge", meaning to show that the obligation expression is always true.**

_But this one isn't true, surely?_

**I agree. But how do you know?**

_Well, just look at it! It's saying that all numbers are valid indexes for all sequences. That's rubbish. 12345 isn't a valid index of [1,2,3] for example, and zero isn't a valid index of anything. So it's obviously false._

**Exactly. You know that the obligation isn't _provable_ because you can think of a _counterexample_. That's definitely a way to show that an obligation cannot be met or discharged or proved or whatever you want to call it.**

_Okay, so the PO generator will show you the obligations, and then you have to try to think of counterexamples?_

**Well, that works for a simple example like this. But a spec doesn't have to get much more complicated before its POs are much harder to understand and discharge.**

_But can't the tools do that for me?_

**Sometimes, yes. That is what QuickCheck does. It tries to quickly find counterexamples to proof obligations.**

_Ah, hence the name! I see. So could QuickCheck find a counterexample here?_

**Let's try:**
```vdm
> qc
PO #1, FAILED in 0.001s
Counterexample:
f: sequence apply obligation in 'DEFAULT' (test.vdm) at line 3:16
(forall s:seq of nat, i:nat &
 --> i = 0, s = []
  i in set inds s)
  --> returns false
```
_Wow, that's quick!_

**It's a VERY small example, but yes, it is trying to take no more than a few seconds to find a counterexample.**

_And `qc` just means QuickCheck?_

**Yes, you can actually type `quickcheck` if you prefer, but... we're trying to be quick here.**

_So hold on, let me try to understand what it's saying. The PO "failed" -- that's failed to verify in some way, I guess -- and the counterexample is shown as `-->` values for `i` and `s` from the `forall` at the start of the PO. And sure enough, `i` is not in the set `inds s`, so it returns false. Fantastic!_

**Right, so we quickly identified a problem. But what should we do about it?**

_Why do we have to do anything about it?_

**If you leave it as it stands, and someone calls this function without meeting this obligation (and nothing is forcing them to), the specification will give undefined behaviour (in the real world, the system might crash). So until this is fixed, you're depending on human beings being careful. That's not good!**

_Okay, but surely if we fix this problem, won't it just mean that the callers of the function have to change? We've just shifted the problem somewhere else?_

**That's true. But if they have to change too, it means that there _genuinely was a problem_ with what they were doing. And fixing that will allow us to find and fix problems with their callers, and so on. So the process of discharging POs ripples through your specification, bringing benefits throughout.**

_Okay I get that. So to fix this example, we have to tweak the spec somehow?_

**Yes, but how?**

_Well, that PO will never be true, so we have to change the spec so that it doesn't generate this PO, or perhaps doesn't generate any POs?_

**Basically, yes that's right. Either we have to tweak the spec so that it generates a PO that is always true, or so that there are simply no obligations placed on us. That will then have "tightened" the specification to the point where we are sure that it will always do what we expect, instead of giving undefined behaviour for some inputs. As you said before, this is a formal specification, so it should be well defined for all valid inputs.**

_So what can we tweak to fix this?_

**In cases like this, the problem is because the arguments passed to the function are not sufficiently constrained to guarantee what the function does. They're too loose, in a sense.**

_So we can tighten them?_

**Of course. Any idea how?**

_Hmmm. One thing I thought of when you mentioned passing zero. The index to a sequence in VDM starts at 1. So really the `i` parameter ought to be a `nat1`. Would that be enough?_

**Good idea. Let's try that. Here's the new obligation and `qc` result:**

```vdm
> pog
Generated 1 proof obligation:

Proof Obligation 1: (Unproved)
f: sequence apply obligation in 'DEFAULT' (test.vdm) at line 3:16
(forall s:seq of (nat), i:nat1 &
  i in set inds s)

> qc
PO #1, FAILED in 0.001s
Counterexample:
f: sequence apply obligation in 'DEFAULT' (test.vdm) at line 3:16
(forall s:seq of nat, i:nat1 &
 --> i = 1, s = []
  i in set inds s)
  --> returns false

> 
```
_Okay, so I see that the `i` is now a `nat1`, so it's just switched the counterexample from `0` to `1`. But we're still not done fixing the spec then? We still have to fix that obligation?_

**Yes. Any other ideas how?**

_All I can think of is spelling it out... adding a precondition that says the index matches the sequence?_

**Okay let's try that... I'll add a precondition that says `i in set inds s`**

```vdm
> pog
Generated 1 proof obligation:

Proof Obligation 1: (Unproved)
f: sequence apply obligation in 'DEFAULT' (test.vdm) at line 3:16
(forall s:seq of (nat), i:nat1 & pre_f(s, i) =>
  i in set inds s)

> qc
PO #1, MAYBE in 0.001s
>
```
_LOL, well I suppose `MAYBE` is an improvement. But what does that mean?_

**The `MAYBE` result means that it couldn't find any counterexamples.**

_But if there are no counterexamples, it must always be true, surely?_

**It only means it couldn't _find_ any counterexamples. Maybe they exist, but it couldn't find one _quickly_.**

_Oh. I was hoping we could prove things. That's an important part of using formal specification, right?_

**Yes, if you want very high confidence in your specification, you need to prove its obligations. But that is a non-trivial process in general. The QuickCheck tool is trying to quickly catch the "stupid cases" where you have missed a check or a precondition and so on. That helps improve specifications, but a QuickCheck `MAYBE` is not the same as a proof. It's necessary, but not sufficient.**

_So `qc` can't really prove anything?_

**It is really designed to _disprove_ POs. But there are also some cases where it can indicate POs should be provable. For example when POs follow very simple patterns which are known always to be true, or if you have finite types, where it can check every possible value, or if the PO starts with `exists` rather than `forall`, then one witness value is proof of existence.**

_But this still only means that it should be provable, not that it is actually proved?_

**Yes. We have to be careful with what we claim about proof. QuickCheck is not a prover/solver and there are lots of subtle aspects to fully formal proof that the tool cannot analyse. But if we claim an obligation is `PROVABLE` it means we have good reason to believe that a proof should be easy to find, and the tool may explain how it came to that conclusion. This is very useful, but it is not a formal proof.**

**So for example, if I wrap the `s(i)` result in a check, like `if i in set inds s then s(i) else 0`, you get the following:**
```vdm
> pog
Generated 1 proof obligation:

Proof Obligation 1: (Unproved)
f: sequence apply obligation in 'DEFAULT' (test.vdm) at line 3:40
(forall s:seq of (nat), i:nat1 &
  ((i in set (inds s)) =>
    i in set inds s))

> qc
PO #1, PROVABLE by trivial (i in set (inds s)) in 0.001s
> 
```
**You can see the PO says, "if the index works, the index works". Well duh, of course that's true, so the PO is "trivially provable", and it shows you the expression that it knew had to be true.**

_So why didn't that work with that same clause in the precondition?_

**That's because the precondition uses `pre_f(s, i)` as the test in the PO. So `qc` can't _quickly_ tell that it matches the simple pattern. A more powerful proof engine would be able to do that though.**

_And you said that finite types could be checked exhaustively? Does that lead to a provable PO?_

**Yes! It works when your proof obligation _only_ uses finite types, and the size of the type must be less than 100,000 by default. But sometimes it can indicate these POs are provable. For example, imagine a function like this:**
```vdm
functions
	f: set of set of bool -> nat1
	f(s) ==
		if s = {}
		then 999
		else card s;

> pog
Generated 1 proof obligation:

Proof Obligation 1: (Unproved)
f: subtype obligation in 'DEFAULT' (test.vdm) at line 2:5
(forall s:set of (set of (bool)) &
  (if (s = {}) then 999 else (card s)) > 0)

> qc
PO #1, PROVABLE by finite types in 0.011s
> 
```
**Admittedly this is a contrived example, but you see that the obligation says that the body of the function must produce a `nat1` for all sets of sets of booleans. But that is a finite type (there are only 16 members of the type), so it can easily try them all. And since there are no counterexamples found, and every value was tried, the PO should be `PROVABLE` as you see.**

_Okay, so QuickCheck is small and fast and tries to find problems, but ultimately for formal proof you need more powerful tools?_

**Exactly. Though we can keep improving `qc` to try more and more strategies, to find as many problems as we can. Ultimately, we can write a strategy that calls out to a more powerful solver.**

_What's a strategy?_

**Now we're getting into the internals of [how QuickCheck works](https://github.com/nickbattle/vdmj/wiki/QuickCheck-Strategies). That discussion describes the various strategies. But basically, a strategy is just a particular approach to finding counterexamples.**

_Okay, let's stick to the basic usage for now. So does `qc` always check all of the POs in your spec?_

**By default, it only checks POs in the current module or class. But there are a lot of options that you can pass to change that. The `-help` option lists them:**

```vdm
> qc -help
Usage: quickcheck [-?|-help][-q|-v|-n][-t <msecs>]
  [-i <status>]* [-s <strategy>]* [-<strategy:option>]* [<PO numbers/ranges/patterns>]

  -?|-help           - show command help
  -q|-v|-n           - run with minimal or verbose output
  -t <msecs>         - timeout in milliseseconds
  -i <status>        - only show this result status
  -s <strategy>      - enable this strategy (below)
  -<strategy:option> - pass option to strategy
  PO# numbers        - only process these POs
  PO# - PO#          - process a range of POs
  <pattern>          - process PO names or modules matching
...
```
_Okay, that makes sense. But it looks like you can give specific PO numbers to `qc`?_

**Yes, after the other options. You can check a list of POs by passing their PO number(s). You can also give an inclusive range of PO numbers with a hyphen, like `100 - 120`, or you can give function or module/class name pattern(s) to process all of the POs that match. You can also mix these approaches in one invocation.**

_That could still get a bit tedious?_

**Remember, we have the VDMJ `script` command. So if you are doing lots of complicated `qc` commands, you can put them into a script and execute them easily.**

_Cool! So is there anything else I should know about QuickCheck?_

**One point is that it can't process all POs. You can always run `qc`, but some POs will show a status of `UNCHECKED`.**

_Why can't you check them?_

**There are various reasons. For example, one common case is where you have a recursive function without a measure defined. That produces an obligation on the `measure_f` call, but since there is no measure, that function is not defined. In effect it is inviting you to define a measure, and there would be a warning from the typechecker telling you this too. Another example is with operations that throw exceptions. Here the logic is too complicated to analyse at the moment, though it is an area for future improvement. You should get an explanation for why a PO is UNCHECKED, like this.**

```vdm
PO #85, UNCHECKED (Obligation for missing measure function)
PO #98, UNCHECKED (Not yet supported for operations)
```

_Fair enough. Anything else?_

**One point to note is that, in general, proof obligations that come from VDM operations are [much more complicated](https://github.com/nickbattle/vdmj/wiki/Operation-Obligations) than those that come from functions. It's because operations can change state data, and because you can have complex control flows, [such as loops](https://github.com/nickbattle/vdmj/wiki/Loop-Invariant-Annotations). These can still be processed by `qc`, but they will probably take longer to find counterexamples.**

_Do you have to run `qc` differently to handle operation POs?_

**No, it's exactly the same, and you can mix function and operation POs in one `qc` check. But operation POs are more complicated, as I said. In some cases, VDM++ operation POs cannot be checked because the system state has not been defined in the language. For example, the `pre_op` function that accompanies a VDM-SL operation called `op` has a well defined "sigma" argument that represents the module state. But there is no such equivalent defined for VDM++ or VDM-RT object state.**

_That's quite a surprise... why isn't the state defined for VDM++?_

**I'm guessing, but I think it was a pragmatic decision to define the object oriented aspects of the language as a priority, presumably with the intention of covering the proof theory later. But the latter step was never taken, in part because it is significantly harder to represent the system state when it can be shared by an arbitrary set of objects. Remember VDM++ also introduces concurrency, which significantly complicates the proof theory.**

_So is it impossible to do formal verification in VDM++?_

**You can do some verification work, especially if you are only working with functions. But if you get much more complicated than that, many of the POs produced will be `UNCHECKED` and there is no proof theory for VDM++ concurrency at all. So what you can verify is limited.**

_Okay, I'll try to stick with VDM-SL when I'm being formal! So what else should I know?_

**You may sometimes find that the check of the PO with some particular values produces a runtime error _in the PO itself_. In this case, you will get a normal VDMJ error message, as well as a counterexample. The error is shown to help you work out why the PO itself is failing, which indicates an underlying issue in your spec.**

**Here's a small example:**
```vdm
functions
	f: seq of nat -> nat
	f(a) == let s = g(a) in hd s;
	
	g: seq of nat -> seq of nat
	g(z) == [hd z] ^ tl z;

> qc
PO #1, FAILED in 0.019s
Counterexample:
f: non-empty sequence obligation in 'DEFAULT' (test.vdm) at line 3:32
(forall a:seq of nat &
 --> a = []
  (let s : seq of nat = g(a) in
   --> z = [] in 'DEFAULT' (test.vdm) at line 6:7
   --> Error 4010: Cannot take head of empty sequence in 'DEFAULT' (test.vdm) at line 6:14
    s <> []))

```
**So you can see that on the way to checking `s <> []` it has to call `g(a)`, which causes an error elsewhere on line 6 of `test.vdm` if the `z` parameter is empty. You get other POs that tell you that the argument to `g(z)` cannot be empty, but until those are fixed, this PO fails during execution.**

_So it's best to try to fix POs in functions that are called first?_

**If possible, yes. In this case, you can make g's parameter a `seq1 of nat`, for example. That will eliminate the obligation in g, but then you will get push-back to f's parameter to say that it should also be a `seq1 of nat`, unless you add a precondition, say. Sometimes chasing errors like this can get quite subtle.**

_Okay... what else should I know?_

**One small point to remember is that, if you're changing your specification, the PO numbers will change. This could be annoying if you have prepared scripts with `qc` commands for specific PO numbers. But remember you can give `qc` a list of names, meaning "all the POs in this list of functions", which is more stable (until you rename the functions!). You can see the problem.**

_Yes, tricky to fix that one. Anything else?_

**One thing to mention is the `@QuickCheck` annotation. This can be used to bind particular types to a polymorphic function's type parameters when QC checks it. By default, `@T` parameters are bound to `real`, but that may not be sensible for all functions. For example:**

```vdm
functions
	-- @QuickCheck @T = bool, set of bool;
	f[@T]: set of @T -> nat1
	f(s) == card s;

> qc 
PO #1, FAILED in 0.016s
Counterexample:
f: subtype obligation in 'DEFAULT' (test.vdm) at line 3:5
--> @T = bool in 'DEFAULT' (test.vdm) at line 2:21
(forall s:set of (@T) &
 --> s = {}
  (card s) > 0)
  --> returns false
```

**Notice that the counterexample shows `--> @T = bool`, which was the first of the types given in the `@QuickCheck` annotation on line 2. This particular example would also fail with the default binding of `@T` to `real`, but you see the point.**

_Yes, okay. Anything else?_

**There's a timeout on the tool, so that really complex examples don't lock up the machine. By default it's 5000ms, which should be plenty of time for most POs, but you can get a result status of `TIMEOUT` if a spec is very complex. This is roughly the same as `MAYBE`. You can change the value using the `-t` option to `qc`. Setting it to zero means no timeout.**

**There's also a `-q` option to do the checks without much output, which is useful if you have another display of the results in a GUI tool, and a `-v` option to be verbose, which can help if you're unsure what's happening. The `-n` option gives nominal output, which is just the status and the duration.**

_Phew. But most of the time you just run `qc`, right?_

**Yes. It's intended to give sensible and useful results by default. The other options are for more advanced use, but we can talk about those in a separate conversation.**
