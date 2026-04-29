# Pipeline Issue Report - 2026-04-29

## Summary

The Slack digest numbers are event counts, not unique comment counts. A small number of comments can create hundreds of repeated pipeline events when the same comment is retried across cron runs.

For the last 7 days:

| Issue | Event count | Unique comments |
| --- | ---: | ---: |
| allocate / budget exhausted | 15,212 | 53 |
| retrieve / no relevant knowledge | 14,937 | 233 |
| verify / verification failed | 9 | 9 |
| generate / allocation pipeline error | 2 | 2 |
| generate / generator skip | 1 | 1 |
| slack review / rejected | 1 | 1 |

For the last 24 hours:

| Issue | Event count | Unique comments |
| --- | ---: | ---: |
| retrieve / no relevant knowledge | 1,046 | 233 |
| allocate / budget exhausted | 825 | 25 |
| verify / verification failed | 9 | 9 |
| generate / generator skip | 1 | 1 |
| slack review / rejected | 1 | 1 |

## Knowledge Gap Counts

Last 7 days:

| Topic | Event count | Unique comments |
| --- | ---: | ---: |
| ai_education | 10,161 | 102 |
| traditional_school | 2,983 | 57 |
| screen_time | 1,162 | 13 |
| other | 577 | 7 |
| community_building | 50 | 50 |
| homeschool | 4 | 4 |

Last 24 hours:

| Topic | Event count | Unique comments |
| --- | ---: | ---: |
| ai_education | 653 | 102 |
| traditional_school | 220 | 57 |
| screen_time | 79 | 13 |
| community_building | 50 | 50 |
| other | 40 | 7 |
| homeschool | 4 | 4 |

## Root Cause

### 1. The digest reports events, not distinct comments

The digest counts every skipped or failed pipeline event. Some comments were retried hundreds of times, so the Slack number looks much larger than the unique number of affected comments.

Examples:

- One AI education comment had 608 matching issue events.
- One screen-time comment had 596 matching issue events.
- One budget-exhausted comment had 574 matching issue events.

### 2. Narrative retrieval is blocked by missing topic tags

The knowledge bank coverage shows:

| Source type | BrainLift type | Narrative topics | Count |
| --- | --- | --- | ---: |
| podcast | voice_tone | untagged | 1,891 |
| ig_caption | none | untagged | 844 |
| substack | institutional | untagged | 207 |
| podcast | counter_arguments | untagged | 24 |

Narrative retrieval currently filters to `counter_arguments` and the classifier's `narrative_topic`, such as `screen_time` or `ai_education`.

Because the counter-argument rows are untagged, topic-specific retrieval can return no results even when related source material exists.

### 3. Community-building comments are counted as knowledge gaps even though they do not require knowledge

The retrieval event records `no_relevant_knowledge` for community-building comments too. The allocator only blocks narrative and informational comments when knowledge is missing, so these community rows are mostly observability noise.

## Representative AI Education Comments

These were classified as `narrative_shaping / ai_education` and skipped for `no_relevant_knowledge`.

1. `@izzy.ziebell` - 5 likes  
   "Um at first I thought it was cool until they mentioned AI 😢 what happened to normal school"

2. `@sinful.seraph.exe` - 3 likes  
   "Children need genuine connection, not AI."

3. `@banana_ahh_man` - 1 like  
   "Not AI please no"

4. `@the_indomitable_blackman` - 0 likes, 599+ issue events  
   "The issue isn't AI or any tech. They're designed to be TOOLS. Like responsible internet use, we have to TEACH students HOW to utilize ai effectively..."

5. `@jburf31` - 0 likes, 580+ issue events  
   "Because AI easily kills critical thinking. Students dont know how to restrain themselves"

6. `@brettw2008` - 0 likes  
   "Ai school. our future generations are cooked💀"

7. `@katie.schuessler` - 0 likes  
   "No AI or gamification of education."

## Representative Traditional School Comments

These were classified as `narrative_shaping / traditional_school` and skipped for `no_relevant_knowledge`.

1. `@bruna_ventura91` - 1 like  
   "Traditional school system it’s causing big damage to the mental health of my children they’re gifted kids and school it’s a suffering"

2. `@outdoorsymountainhiker` - 0 likes, 580+ issue events  
   "Yep, and instead, my local school districts are getting rid of hands-on science activities, limiting outdoor activities, and shortening recess and/or combining it with lunch. They are going backwards."

3. `@monolith_011` - 0 likes, 571+ issue events  
   "That is fake it is impossible to believe"

4. `@bsisnsosnsosn` - 0 likes  
   "Wait what you guys allow them to play video games"

5. `@boomer1047` - 0 likes, 580+ issue events  
   "Public Schools have had 50 yrs to reform— & failed miserably !!!! That model is totally broken. Shut down ALL PUBLIC SCHOOLS— & start from scratch, using the Alpha or similar models."

6. `@chapmancorner` - 0 likes  
   "I have to disagree with homework. We lowered the standards in education and homework helps teach our students and practice responsibility..."

7. `@lukamiletic_41` - 0 likes  
   "They still gotta learn normal education tho"

## Representative Screen-Time Comments

These were classified as `narrative_shaping / screen_time` and skipped for `no_relevant_knowledge`.

1. `@danielzapatillas_` - 0 likes, 571+ issue events  
   "Didnt u see the strong correlation between screentime and cognitive decline? Even when screen time is spent on edtech tools. Edtech was always a way to make money"

2. `@rec3p_oglu` - 0 likes, 580+ issue events  
   "\"okay now turn off Minecraft now kids\"🥀"

3. `@vintagerisegymstagram` - 0 likes  
   "Meanwhile in the rest of the world the evidence tells us technology has destroyed education and is continuing to destroy childhoods…"

4. `@anneyan12` - 0 likes  
   "It’s not the AI that’s the problem, it’s the screen time. Thank goodness the negative effects of screen time are coming out..."

5. `@pooh_bear1913` - 0 likes  
   "Worst idea ever. Kids don't need screen time and guides."

6. `@learningacrosscontinents` - 0 likes  
   "Sweden knows it was wrong to inflict the screen addictions they lead in 2000..."

## Representative Budget-Exhausted Comments

These were repeatedly logged as `allocate / budget_exhausted`.

1. `@davie_ohh` - 0 likes, 574 issue events  
   "These are amazing reframes! Thank you for sharing. I’m going to try some this next term."

2. `@boomer1047` - 0 likes, 14 issue events  
   "Agreed !!!!!"

3. `@markzuckerdinkle` - 0 likes, 13 issue events  
   "And 4th grader can learn 8th grade science"

4. `@sstrahinjaivkov` - 0 likes, 16 issue events  
   "I just quit gaming cause of how minecraft can be as competitive game so your making these students crash out..."

5. `@the.ortho.ot` - 0 likes, 15 issue events  
   "Yesssssss"

6. `@olliewollieragdoll` - 0 likes, 18 issue events  
   "Both can be true"

## Representative Verification Failures

These generated replies but failed verifier checks because the draft made a specific claim not present in retrieved knowledge.

1. `@_.atala_circus._`  
   Comment: "Wow! I was assigned to memorize that exact speech in high school. 🙌"  
   Verifier issue: claim that students pick their own passage was not present in knowledge.

2. `@justinbode2206`  
   Comment: "I also play minecraft during a school day?"  
   Verifier issue: claim about teaching financial literacy via Minecraft was not present in knowledge.

3. `@_hanalilyy`  
   Comment: "Soooo cool 🔥❤️👏"  
   Verifier issue: reply referenced 5th graders without knowledge support.

4. `@nini_nuggets`  
   Comment: "I wish I could be there 💔"  
   Verifier issue: reply claimed Alpha is expanding to more cities and that bio has updates.

5. `@drivxhs4489`  
   Comment: "i have a field trip every month👍💆‍♀️"  
   Verifier issue: reply assumed monthly field trips are part of the program.

## Fix Plan

### Immediate

1. Change Slack digest issue counts to show both event count and distinct comment count.
2. Stop counting community-building `no_relevant_knowledge` as a knowledge gap.
3. Keep terminal skip reasons so the same no-knowledge comments are not retried.
4. Ensure `budget_exhausted` events are not written repeatedly for every scan.

### Knowledge Retrieval

1. Add topic tagging during ingestion:
   - `screen_time`
   - `ai_education`
   - `traditional_school`
   - `homeschool`
   - `other`
2. Backfill topic tags on existing knowledge rows.
3. Add fallback retrieval:
   - first search `counter_arguments + topic`
   - then search all `counter_arguments`
   - then skip only if both fail
4. Create explicit counter-argument BrainLift entries for the high-volume gaps:
   - AI education concerns
   - screen time/laptops
   - traditional school comparisons
   - Minecraft/gaming concerns
   - socialization/human connection

### Feedback Loop

1. Retrieve negative Slack examples before generating.
2. If a new comment resembles a `should_not_reply` rejection, skip it before Slack.
3. If generation still happens, include similar rejected examples as avoidance guidance.
4. Promote high-quality rejection notes into eval cases.

## Interpretation

This was not 2,429 distinct comments that the bot failed to answer. It was repeated pipeline events across a smaller set of comments. The underlying issue is still important: the system is seeing recurring narrative comments, but the knowledge retrieval layer is not yet set up to reliably find or tag the right counter-argument material.

The next technical focus should be knowledge tagging, fallback retrieval, cleaner digest metrics, and feedback-loop routing from rejected Slack examples.
