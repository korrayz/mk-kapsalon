/* ============================================================
   MK KAPSALON — Interactions
   ============================================================ */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Footer year ---------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Sticky header ---------- */
  var header = document.getElementById("siteHeader");
  function onScroll() {
    if (!header) return;
    header.classList.toggle("scrolled", window.scrollY > 24);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- Mobile menu ---------- */
  var navToggle = document.getElementById("navToggle");
  var backdrop = document.getElementById("menuBackdrop");
  function closeMenu() {
    document.body.classList.remove("menu-open");
    if (navToggle) {
      navToggle.setAttribute("aria-expanded", "false");
      navToggle.setAttribute("aria-label", "Menu openen");
    }
  }
  function openMenu() {
    document.body.classList.add("menu-open");
    if (navToggle) {
      navToggle.setAttribute("aria-expanded", "true");
      navToggle.setAttribute("aria-label", "Menu sluiten");
    }
  }
  if (navToggle) {
    navToggle.addEventListener("click", function () {
      document.body.classList.contains("menu-open") ? closeMenu() : openMenu();
    });
  }
  if (backdrop) backdrop.addEventListener("click", closeMenu);
  document.querySelectorAll("#mainNav a, [data-close-menu]").forEach(function (a) {
    a.addEventListener("click", closeMenu);
  });

  /* ---------- Scroll reveal ---------- */
  var reveals = document.querySelectorAll(".reveal");
  if (prefersReduced || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Opening hours: open/closed badge + today highlight ---------- */
  // NOTE: openingstijden zijn placeholder — pas aan naar de echte tijden.
  var HOURS = {
    1: [12, 18], // Ma
    2: [9, 18],  // Di
    3: [9, 18],  // Wo
    4: [9, 18],  // Do
    5: [9, 18],  // Vr
    6: [9, 18],  // Za
    0: null      // Zo gesloten
  };
  (function markHours() {
    var now = new Date();
    var day = now.getDay();
    var hour = now.getHours() + now.getMinutes() / 60;
    var todayLi = document.querySelector('#hoursList li[data-day="' + day + '"]');
    if (todayLi) todayLi.classList.add("today");

    var badge = document.getElementById("openBadge");
    if (!badge) return;
    var t = HOURS[day];
    var isOpen = t && hour >= t[0] && hour < t[1];
    if (isOpen) {
      badge.innerHTML = '<span class="dot"></span> Nu geopend';
      badge.style.color = "var(--success)";
    } else {
      badge.innerHTML = "Nu gesloten";
      badge.style.background = "rgba(255,255,255,0.05)";
      badge.style.borderColor = "var(--line-strong)";
      badge.style.color = "var(--muted)";
    }
  })();

  /* ---------- Booking: date default, time slots ---------- */
  var dateInput = document.getElementById("f-datum");
  var slotsWrap = document.getElementById("timeSlots");
  var selectedTime = null;

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  if (dateInput) {
    dateInput.min = todayISO();
    dateInput.value = todayISO();
  }

  // Some pseudo-booked slots so the UI feels alive (deterministic-ish per day).
  function buildSlots() {
    if (!slotsWrap) return;
    selectedTime = null;
    slotsWrap.innerHTML = "";

    var dayStr = dateInput ? dateInput.value : todayISO();
    var d = dayStr ? new Date(dayStr + "T00:00:00") : new Date();
    var dow = d.getDay();
    var range = HOURS[dow];

    if (!range) {
      slotsWrap.innerHTML =
        '<p style="grid-column:1/-1;color:var(--muted);font-size:.9rem;">Op deze dag zijn we gesloten. Kies een andere datum.</p>';
      return;
    }

    var start = range[0];
    var end = range[1];
    var times = [];
    for (var h = start; h < end; h++) {
      times.push(pad(h) + ":00");
      times.push(pad(h) + ":30");
    }

    // Deterministic "booked" pattern based on date, so it's stable per day.
    var seed = d.getDate() + dow * 3;
    times.forEach(function (time, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      btn.textContent = time;
      btn.setAttribute("aria-pressed", "false");

      var booked = (i * 7 + seed) % 5 === 0; // ~20% booked
      // Past times for today are disabled
      var isToday = dayStr === todayISO();
      var nowH = new Date().getHours() + new Date().getMinutes() / 60;
      var slotH = parseInt(time, 10) + (time.indexOf("30") > -1 ? 0.5 : 0);
      var past = isToday && slotH <= nowH;

      if (booked || past) {
        btn.disabled = true;
      } else {
        btn.addEventListener("click", function () {
          slotsWrap.querySelectorAll(".slot").forEach(function (s) {
            s.setAttribute("aria-pressed", "false");
          });
          btn.setAttribute("aria-pressed", "true");
          selectedTime = time;
        });
      }
      slotsWrap.appendChild(btn);
    });
  }
  buildSlots();
  if (dateInput) dateInput.addEventListener("change", buildSlots);

  /* ---------- Booking submit ---------- */
  var bookingForm = document.getElementById("bookingForm");
  var bookingSuccess = document.getElementById("bookingSuccess");
  if (bookingForm) {
    bookingForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var dienst = document.getElementById("f-dienst");
      var barber = document.getElementById("f-barber");
      var datum = document.getElementById("f-datum");
      var naam = document.getElementById("f-naam");
      var tel = document.getElementById("f-tel");

      // Simple validation with focus on first invalid
      var required = [dienst, barber, datum, naam, tel];
      for (var i = 0; i < required.length; i++) {
        if (!required[i].value) {
          required[i].focus();
          required[i].style.borderColor = "var(--danger)";
          setTimeout(function (el) {
            return function () { el.style.borderColor = ""; };
          }(required[i]), 1800);
          return;
        }
      }
      if (!selectedTime) {
        if (bookingSuccess) {
          bookingSuccess.classList.add("show");
          bookingSuccess.style.background = "rgba(224,122,106,0.1)";
          bookingSuccess.style.borderColor = "rgba(224,122,106,0.35)";
          bookingSuccess.style.color = "#f0b8ae";
          bookingSuccess.innerHTML = "Kies nog een <b>tijd</b> om je afspraak te bevestigen.";
        }
        if (slotsWrap) slotsWrap.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "center" });
        return;
      }

      // Success (front-end only — later gekoppeld aan backend)
      var dateFmt = new Date(datum.value + "T00:00:00").toLocaleDateString("nl-NL", {
        weekday: "long", day: "numeric", month: "long"
      });
      if (bookingSuccess) {
        bookingSuccess.classList.add("show");
        bookingSuccess.style.background = "";
        bookingSuccess.style.borderColor = "";
        bookingSuccess.style.color = "";
        bookingSuccess.innerHTML =
          "Bedankt <b>" + escapeHtml(naam.value) + "</b>! Je aanvraag voor <b>" +
          escapeHtml(dienst.value) + "</b> op <b>" + dateFmt + " om " + selectedTime +
          "</b> is ontvangen. We bevestigen zo snel mogelijk via SMS. " +
          "<br><em style='color:var(--muted);font-style:normal;font-size:.85rem;'>" +
          "(Demo — nog niet gekoppeld aan een echt boekingssysteem.)</em>";
        bookingSuccess.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "center" });
      }
      bookingForm.reset();
      if (dateInput) { dateInput.value = todayISO(); }
      buildSlots();
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- Login modal ---------- */
  var modal = document.getElementById("loginModal");
  var openLoginBtn = document.getElementById("openLogin");
  var lastFocused = null;

  function openModal() {
    if (!modal) return;
    lastFocused = document.activeElement;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    var firstInput = modal.querySelector("input");
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 60);
  }
  function closeModal() {
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (lastFocused) lastFocused.focus();
  }
  if (openLoginBtn) openLoginBtn.addEventListener("click", openModal);
  document.querySelectorAll("[data-close-modal]").forEach(function (el) {
    el.addEventListener("click", closeModal);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (modal && modal.classList.contains("open")) closeModal();
      if (document.body.classList.contains("menu-open")) closeMenu();
    }
    // Basic focus trap inside modal
    if (e.key === "Tab" && modal && modal.classList.contains("open")) {
      var focusables = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });

  var loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = loginForm.querySelector('button[type="submit"]');
      if (btn) {
        var orig = btn.textContent;
        btn.textContent = "Bezig...";
        btn.disabled = true;
        setTimeout(function () {
          btn.textContent = "Inloggen mislukt — demo";
          setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 1600);
        }, 700);
      }
    });
  }

  /* ---------- Gallery filter (gallery.html) ---------- */
  var filterChips = document.querySelectorAll(".filter-chip");
  var galleryCards = document.querySelectorAll("#masonry .g-card");
  if (filterChips.length && galleryCards.length) {
    filterChips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        filterChips.forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        var filter = chip.getAttribute("data-filter");
        galleryCards.forEach(function (card) {
          var cats = card.getAttribute("data-cat") || "";
          var show = filter === "all" || cats.split(" ").indexOf(filter) > -1;
          card.classList.toggle("hide", !show);
        });
      });
    });
  }

  /* ---------- Lightbox (gallery.html) ---------- */
  var lightbox = document.getElementById("lightbox");
  if (lightbox && galleryCards.length) {
    var lbImg = document.getElementById("lbImg");
    var lbCaption = document.getElementById("lbCaption");
    var lbCounter = document.getElementById("lbCounter");
    var lbPrev = lightbox.querySelector(".lb-prev");
    var lbNext = lightbox.querySelector(".lb-next");
    var lbLastFocus = null;

    // Build item list dynamically (respects current visible order)
    function visibleCards() {
      return Array.prototype.filter.call(galleryCards, function (c) {
        return !c.classList.contains("hide");
      });
    }
    var currentList = [];
    var currentIndex = 0;

    function showItem(i) {
      if (!currentList.length) return;
      currentIndex = (i + currentList.length) % currentList.length;
      var card = currentList[currentIndex];
      var img = card.querySelector("img");
      lbImg.src = img.getAttribute("src");
      lbImg.alt = img.getAttribute("alt") || "";
      lbCaption.textContent = card.getAttribute("data-caption") || "";
      lbCounter.textContent = (currentIndex + 1) + " / " + currentList.length;
    }
    function openLb(card) {
      currentList = visibleCards();
      var idx = currentList.indexOf(card);
      lbLastFocus = document.activeElement;
      lightbox.classList.add("open");
      document.body.style.overflow = "hidden";
      showItem(idx < 0 ? 0 : idx);
      if (lbNext) lbNext.focus();
    }
    function closeLb() {
      lightbox.classList.remove("open");
      document.body.style.overflow = "";
      lbImg.src = "";
      if (lbLastFocus) lbLastFocus.focus();
    }

    galleryCards.forEach(function (card) {
      card.addEventListener("click", function () { openLb(card); });
    });
    if (lbPrev) lbPrev.addEventListener("click", function () { showItem(currentIndex - 1); });
    if (lbNext) lbNext.addEventListener("click", function () { showItem(currentIndex + 1); });
    lightbox.querySelectorAll("[data-lb-close]").forEach(function (el) {
      el.addEventListener("click", closeLb);
    });
    document.addEventListener("keydown", function (e) {
      if (!lightbox.classList.contains("open")) return;
      if (e.key === "Escape") closeLb();
      else if (e.key === "ArrowLeft") showItem(currentIndex - 1);
      else if (e.key === "ArrowRight") showItem(currentIndex + 1);
    });
  }

  /* ---------- Contact form (contact.html) ---------- */
  var contactForm = document.getElementById("contactForm");
  var contactSuccess = document.getElementById("contactSuccess");
  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var naam = document.getElementById("c-naam");
      var email = document.getElementById("c-email");
      var bericht = document.getElementById("c-bericht");
      var required = [naam, email, bericht];
      for (var i = 0; i < required.length; i++) {
        if (!required[i].value.trim()) {
          required[i].focus();
          required[i].style.borderColor = "var(--danger)";
          setTimeout(function (el) { return function () { el.style.borderColor = ""; }; }(required[i]), 1800);
          return;
        }
      }
      if (contactSuccess) {
        contactSuccess.classList.add("show");
        contactSuccess.innerHTML =
          "Bedankt <b>" + escapeHtml(naam.value) + "</b>! Je bericht is verzonden. " +
          "We nemen snel contact met je op." +
          "<br><em style='color:var(--muted);font-style:normal;font-size:.85rem;'>" +
          "(Demo — nog niet gekoppeld aan e-mail/backend.)</em>";
        contactSuccess.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "center" });
      }
      contactForm.reset();
    });
  }
})();
