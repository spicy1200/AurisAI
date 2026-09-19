/** Heuristic: is this interviewer final likely a question to answer? (N6.4) */

const ACK_ONLY =
  /^(好的?|好|嗯+|哦+|啊+|行|可以|没问题|开始吧|我们开始|下一个|下一位|继续|谢谢|感谢|明白了?|了解|收到|ok|okay|yes|yeah|right|alright|sure|thanks?|thank you)[.。!！…]*$/i;

const QUESTION_MARK = /[?？]/;

const QUESTION_CUES =
  /(吗|呢|么|啥|哪|几|多少|为什么|为啥|为何|怎么|怎样|如何|是否|能否|可否|有没有|是不是|会不会|请介绍|请说明|请描述|请讲|谈谈|说说|讲讲|自我介绍|有什么|什么是|区别是|优缺点|原理|存放|存储|用过|做过|了解|熟悉|负责|对比|举例)/;

const MIN_CHARS = 4;

export function looksLikeInterviewQuestion(raw: string): boolean {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < MIN_CHARS) return false;
  if (ACK_ONLY.test(text)) return false;
  if (QUESTION_MARK.test(text)) return true;
  if (QUESTION_CUES.test(text)) return true;
  return false;
}
