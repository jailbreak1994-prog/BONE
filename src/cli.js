// Dùng không cần giao diện:  npm run cli -- --topic "5 sự thật về mèo" --scenes 4 --llm anthropic
import { parseArgs } from "node:util";
import { newJob, runJob, validateOptions } from "./pipeline.js";

const { values } = parseArgs({
  options: {
    topic: { type: "string" },
    language: { type: "string" },
    duration: { type: "string" },
    scenes: { type: "string" },
    aspect: { type: "string" },
    style: { type: "string" },
    mode: { type: "string" },
    llm: { type: "string" },
    image: { type: "string" },
    video: { type: "string" },
    tts: { type: "string" },
    voice: { type: "string" },
    "no-subtitles": { type: "boolean" },
  },
});

const input = Object.fromEntries(
  Object.entries({
    topic: values.topic,
    language: values.language,
    durationSec: values.duration,
    sceneCount: values.scenes,
    aspect: values.aspect,
    style: values.style,
    visualMode: values.mode,
    llm: values.llm,
    image: values.image,
    video: values.video,
    tts: values.tts,
    voice: values.voice,
    subtitles: values["no-subtitles"] ? false : undefined,
  }).filter(([, v]) => v !== undefined),
);

try {
  const job = newJob(validateOptions(input));
  let printed = 0;
  await runJob(job, (j) => {
    while (printed < j.logs.length) console.log(j.logs[printed++]);
  });
  if (job.status !== "done") process.exit(1);
  console.log(`\n✅ Video: output/${job.id}/video.mp4`);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
