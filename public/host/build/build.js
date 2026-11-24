// @ts-check
// Library and builder page (B3, TECH-SPEC 3.2): /host/build lists quizzes,
// /host/build?quiz=<id> opens one in the builder.
import { mountBuilder } from "./builder.js";
import { mountLibrary } from "./library.js";

const root = /** @type {HTMLElement} */ (document.getElementById("host-main"));
const quizId = new URLSearchParams(location.search).get("quiz");
if (quizId) mountBuilder(root, quizId);
else mountLibrary(root);
