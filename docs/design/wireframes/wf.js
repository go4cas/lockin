// Wireframe helper: shows one screen (?s=<id>), optionally with a sample venue theme (?theme=<file>).
// Not app code. Lets index.html and the render script open each frame on its own.
(function () {
  var q = new URLSearchParams(location.search);
  var theme = q.get("theme");
  if (theme) {
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = "themes/" + theme + ".css";
    document.head.appendChild(l);
  }
  function show() {
    var id = q.get("s");
    var all = document.querySelectorAll(".screen");
    var el = (id && document.getElementById(id)) || all[0];
    for (var i = 0; i < all.length; i++) all[i].classList.remove("on");
    el.classList.add("on");
  }
  window.LI = {
    teams: [
      "Quizteama Aguilera", "The Usual Suspects", "Les Quizerables", "Agatha Quiztie",
      "Universally Challenged", "Tequila Mockingbird", "Quiz Khalifa", "The Know-It-Ales",
      "Trivia Newton-John", "Sherlock Homies", "Risky Quizness", "Pun Intended",
      "The Fact Hunt", "Mind the Gap", "No Idea", "Cereal Killers",
      "Spice Squirrels", "Brainy Bunch", "Table Six", "The Quizzly Bears",
      "Ctrl Alt Defeat", "Norfolk Enchants", "The A-Team", "Quiz on My Face",
      "Hit or Quiz", "Smarty Pints", "Beer Necessities", "Nerd Herd", "Cheesy Quizzers", "The Mighty Ducks"
    ]
  };
  document.addEventListener("DOMContentLoaded", function () {
    var hooks = document.querySelectorAll("[data-render]");
    for (var i = 0; i < hooks.length; i++) {
      var fn = window[hooks[i].getAttribute("data-render")];
      if (fn) fn(hooks[i]);
    }
    show();
  });
})();
