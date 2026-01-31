# Prompts I Asked (from agent chats)

Below are prompts I asked across agent sessions, extracted from all agent transcripts and listed as text.

## Project / Study App / Data Flow

1. so I want to build a study app with a quiz on regard that will track user preferences such as what user study for what major how long to study for etc however this is my first time building ai agent with cloudfare explain me everything that I need to know prior to start this project so I can fully understand everything

2. explain me data flow and how it works fully so I can understand it from point a to point b, after that I want you to explain me how to work with this what syntax and common things I need to know

3. so my first question is cloudfare can work with other agents other than open ai, for example llama so I won't spend money on the development

4. Explain me how I will manage to store the preferences and also load the messages to the frontend that even on the update will pertain information and state

5. ok how we can create this quiz on the frontend show me one example lets say what major then we will save it to the table that we can update, and additionally I want to store like a knowledge tree of what person store but for that we can have ai tool for that

6. before everything can you check that we transferred everything to llama and it works correctly and not open ai, after that let me deploy it and verify

7. for some reason we have this output and not directly to the llama what is going on explain me so I can fully understand it

8. lets start with a first feature, I want to build ai questions what is your name, major, what is current year, what is the goal (study for exam, learn new concept, or take the quiz), then depending on this we going to branch and we asking whether three options 1. what you want to learn today, then what concept, what style of learning user prefer (give me hints maybe like a multiple choice) 2 what to test prepare for, how in depth, and for how much time left, depending on that we will give whether summary or in depth planning topic 3 what is quiz on, how many questions you want, multiple choice style, hints allowed or no, or free response

9. for this save preference and ask whether we are ready to start

10. onboarding flow seems correct, now lets talk about memory and how we going to preserve user preferences and also keep track of user knowledge so we can refer to it

11. also what our options for knowledge tree as it will extensively take memory and also so we can make quick interactions and it also logically stores, maybe we should use graph or vectorized database

12. but the thing is wont we manage to discover this with ai like we can keep it as sql database and ask what relates to this or prerequisite that we have in memory

13. yes now lets do full plan of what we need to have in order to achieve it

14. wont it be easier and more efficiently to store goal as enum type?

15. I think we should keep everything as enum but with learn_style we should have better categories like lets talk about that

16. no incorporate everything in the final plan and I will review it

---

## Implement Plan / To-dos

17. Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. I will then check it myself

18. Implement the following to-dos from the plan (the plan is attached for your reference). Do NOT edit the plan file itself. I will then check it myself

19. Implement the following to-dos from the plan (the plan is attached for your reference). Do NOT edit the plan file itself. You have been assigned the following 1 to-do(s) with IDs: init-tables. 1. [init-tables] Implement initTables() with all 5 CREATE TABLE statements including CHECK constraints. I will then check it myself

20. Implement the following to-dos from the plan (the plan is attached for your reference). Do NOT edit the plan file itself. You have been assigned the following 1 to-do(s) with IDs: session-methods. 1. [session-methods] Implement getSessionPreferences(), updateSessionPreferences() with enum validation I will then check it myself

21. Implement the following to-dos from the plan (the plan is attached for your reference). Do NOT edit the plan file itself. You have been assigned the following 1 to-do(s) with IDs: profile-methods. 1. [profile-methods] Implement getUserProfile(), updateUserProfile() with JSON learning methods support. I will then check it myself

22. Implement the following to-dos from the plan (the plan is attached for your reference). Do NOT edit the plan file itself. You have been assigned the following 1 to-do(s) with IDs: quiz-methods. 1. [quiz-methods] Implement recordQuiz(), getQuizHistory(), getQuizStats() with enum types. I will then check it myself

---

## AI / Workflow / Not Working

23. for some reason my ai doesnt ask any questions why is thatm, lets debug whether it is an issue with the model

24. but also will it prompt me for everything that I need or no

25. still it doesnt respond and follow workflow and also it seems like agent is completely unaware of what is happening, we need to add debug statemetns

26. nothing happens afterwards

27. for some reason updates only happens when I update the page why is that

28. after one message ai stops and also look at the format of the output

29. now it is working but it doesnt follow a workflow or whatsoever it is doing something weird

30. it doesnt do it for some reason

31. lets start over explain me how our thing is currently working so I can fully understand

32. when I am entering nothing is happens for some reason

33. everything was good up to this point

34. look we going in circle for some reason when we switching to smaller model it is working up to a point and when we work with a larger model for some reason it doesnt work at all, what are our all options to fix this explain me maybe it scheduling of the tasks

35. just comment it or like disable the tool calling dont delete anything

---

## Understanding the Code / How It Works

36. now lets step back explain me what is working currently how it is working so I can fully understand everything

37. can you show me what in the code working how it is all interconnected and everything

38. so far we pretty much sending message to the backend to ai through websocket api thats correct we dont have any workflows or whatsoever explain me so I can fully understand it myself

39. why then we can have the issue of not getting response from the ai and stopping it at some point explain me so I can fully understand and debug it to figure out what is the issue is

40. npx wrangler tail what is this command for so I can fully understand it myself

41. @terminals/3.txt:850-1019 what is going on here explain me so I can fully understand everything in here so I can fully understand it myself

42. but the thing why it is still calling mcp tools and also wont it need to manage to handle it correctly on its own

43. explain me what is the mcp what is used for so I can fully understand what it is doing

44. @server.ts (867-970) explain me how this works so I can fully understand it myself fully

45. @server.ts (911-925) explain me how this is getting connected and why we have @server.ts (897-900) multiple block like this and not all in one block

46. @server.ts (909-910) we doing return before setting the prompt no?

47. how we know that we can set it up where you find this information

48. but how we know our thing use cdk vercel if we work with cloudfare

---

## OOP / Response Cut-off / Logs

49. @terminals/6.txt:7-1020 but look this is not length issue I also want to be it is precise so I can fully understand it

50. yes this is logs for the thing that I send oop questions why is that

51. I want it to be precise if asking for precise definition

52. @terminals/8.txt:802-985 still the same problem

53. check the logs it is still 1148 chars for some reason

54. same thing again so it hard coded issue pretty much so we will need to multistep processing of the prompt somehow, what is our options

---

## Chunking / Sequential / Scheduler / Plan

55. I have few options that I think can work we will send request for prompt with a instruction to end with done and just sent request up until we see done and then give me response or second just save the response from prompt give summary of that and continue from there how you think to approach is better and why and what are other options

56. how the chunked will work explain me so I can fully understand it myself

57. can we combine this chunking with the scheduling just do the scheduling queue and then do that

58. how the parallel processing will work explain me

59. lets do sequential we send request to the ai about the topic concept it split in the prerequisite topics than sent each response to ai if needed split it again and sequentially process it and output it

60. wait before that can we use a scheduler that we have, and also I want ai to split in up to 10 and be precise as possible and if needed user will follow up, additionally we know that maximum of response is 1300 chars so we need to incorporate that

61. but the thing I want to make it general logic for any our prompt for ai so we make it a general processing so we text our ask then ai send a plan of up to ten steps and then we process each step and combine results

---

## No Hardcoding / Onboarding / Meta / Full Context

62. I dont understand why the ai doesnt work properly not supporting basic stuff and if it need it calls function to update and get stuff, is it issue with out tooling or model itself

63. yes exactly how we can support that

64. what you doing dont do this for meta tags we can call ai and ask which he things is appropriate just always sent him full context on what we currently have function what they do whether it is appropriate and also ask user for missing part in order to help and remind what it can do best like why is it so hard just do the plan first I will review it

65. Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. [AI-driven routing plan]

66. also on the page in the react specify everything that you can do like help study concept for exam or quiz you on something

67. @server.ts (932-949) what is this explain me

68. why can't we utilize ai like what is the subject and topic so it can decide and store it

---

## Code Explanations (specific files/lines)

69. @server.ts (167-170) explain me each line here how it works and why so I can fully understand it myself

70. why not to create a separate file what will just export and call this function

71. @server.ts (439-440) what is this explain me so I can fully understand it myself

72. @server.ts (506-550) explain me this so I can fully understand everything what we need it for and so on

73. but the thing is how appropriate it is if it across different domains explain me so I can fully understand it myself

74. explain me is there other way to do durable objects and what they are even is

75. LIMIT and limit variable — explain me this so I can fully understand it myself

76. wait also can we just run after we have all of them in parallel this agents and what is con for that

77. @server.ts (846-849) explain me this each of the things how it work purpose and where it could be used so I know it fully myself

78. @server.ts (852-863) why we have nested brackets and everything explain me the syntax so I can fully understand it myself fully

79. @server.ts (411-519) explain me everything in here how it works and what is currently doing so I can fully understand it myself fully

80. explain me in more technical depth what is each thing is doing so I can fully understand it

81. how to run debugger like tail thing

82. @terminals/9.txt:993-1017 I am getting this why

83. @terminals/13.txt:553-584 look this is a problem for some reason it didnt combine that and start scheduler how I wanted why is that

84. explain me what you changed with what and why so I can fully understand that myself fully

85. explain me fully how function generate plan works so I can fully understand like why it is like this what each line do why we have response and result separate check and what is every single thing in there so I can fully understand it

86. what is difference between result and response why we need separate checks

87. explain me what you did and why so I can fully understand it myself fully

88. I still dont understand why that was an issue explain me

89. nice now it is working correctly, I have another question what is the purpose of splitting logic tools.ts

90. but how ai knows what tools to use

91. @tools.ts (34-74) explain me fully how it works like tool what is z why we getting different things out of there like z.string, optional.describe what is this doing and so on

92. now lets create a plan how to wire it all together

93. all tools step by step

94. wait why tools only work in simple mode if we want it to support like quizzes and knowledge and so on like shouldnt we also care about that

95. lets do like mix of option 1 and option 3 for explanations add to knowledge graph with 50 and then for the quizzes as we said

---

## Types / Interfaces / Promises / Enums

96. explain me why we have interfaces in types what is their purpose and how they work explain me so I fully understand the reasoning behind that

97. show me for example how it is utilized later on just and example so I can fully understand it myself

98. what would happen if we would not use promise and just return and still use await and everything

99. why for enums we specifying ALL = "all" and whatever explain me so I can fully understand it myself

---

## Knowledge / SQL / Data

100. what are you doing we should be able to support general knowledge on anything and let ai decide to create like a binary trees or a graph that will use shortest path and it will assign weights to it like we want to keep it general

101. wait I dont understand how it works now explain me fully so I can understand how we manage to keep track of the knowledge

102. ok what is left to do for our app

103. so lets finish the full logical process so we can finish fully

104. wait so this not sql this is version that cloudfare provides right?

105. but wait the problem is we not prompting user anywhere for this data right and we need to as otherwise how we will manage to update this stuff

## Readme

106. Give me a blueprint for readme
