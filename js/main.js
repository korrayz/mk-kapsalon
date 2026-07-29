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

  /* ---------- i18n helpers (used by dynamic strings) ---------- */
  function curLang() { return document.documentElement.getAttribute("lang") === "en" ? "en" : "nl"; }
  function tr(nl, en) { return curLang() === "en" ? en : nl; }

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
  function markHours() {
    var now = new Date();
    var day = now.getDay();
    var hour = now.getHours() + now.getMinutes() / 60;
    document.querySelectorAll("#hoursList li").forEach(function (li) { li.classList.remove("today"); });
    var todayLi = document.querySelector('#hoursList li[data-day="' + day + '"]');
    if (todayLi) todayLi.classList.add("today");

    var badge = document.getElementById("openBadge");
    if (!badge) return;
    var rng = HOURS[day];
    var isOpen = rng && hour >= rng[0] && hour < rng[1];
    if (isOpen) {
      badge.innerHTML = '<span class="dot"></span> ' + tr("Nu geopend", "Open now");
      badge.style.color = "var(--success)";
      badge.style.background = "";
      badge.style.borderColor = "";
    } else {
      badge.innerHTML = tr("Nu gesloten", "Closed now");
      badge.style.background = "color-mix(in srgb, var(--text) 6%, transparent)";
      badge.style.borderColor = "var(--line-strong)";
      badge.style.color = "var(--muted)";
    }
  }
  markHours();

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
        '<p style="grid-column:1/-1;color:var(--muted);font-size:.9rem;">' +
        tr("Op deze dag zijn we gesloten. Kies een andere datum.",
           "We are closed on this day. Please choose another date.") + "</p>";
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
          bookingSuccess.innerHTML = tr(
            "Kies nog een <b>tijd</b> om je afspraak te bevestigen.",
            "Please pick a <b>time</b> to confirm your appointment."
          );
        }
        if (slotsWrap) slotsWrap.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "center" });
        return;
      }

      // Success (front-end only — later gekoppeld aan backend)
      var dateFmt = new Date(datum.value + "T00:00:00").toLocaleDateString(
        curLang() === "en" ? "en-GB" : "nl-NL",
        { weekday: "long", day: "numeric", month: "long" }
      );
      if (bookingSuccess) {
        bookingSuccess.classList.add("show");
        bookingSuccess.style.background = "";
        bookingSuccess.style.borderColor = "";
        bookingSuccess.style.color = "";
        var demoNote = "<br><em style='color:var(--muted);font-style:normal;font-size:.85rem;'>" +
          tr("(Demo — nog niet gekoppeld aan een echt boekingssysteem.)",
             "(Demo — not yet linked to a real booking system.)") + "</em>";
        bookingSuccess.innerHTML = tr(
          "Bedankt <b>" + escapeHtml(naam.value) + "</b>! Je aanvraag voor <b>" +
            escapeHtml(dienst.value) + "</b> op <b>" + dateFmt + " om " + selectedTime +
            "</b> is ontvangen. We bevestigen zo snel mogelijk via SMS.",
          "Thank you <b>" + escapeHtml(naam.value) + "</b>! Your request for <b>" +
            escapeHtml(dienst.value) + "</b> on <b>" + dateFmt + " at " + selectedTime +
            "</b> has been received. We'll confirm as soon as possible by SMS."
        ) + demoNote;
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
        btn.textContent = tr("Bezig...", "Please wait...");
        btn.disabled = true;
        setTimeout(function () {
          btn.textContent = tr("Inloggen mislukt — demo", "Login failed — demo");
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
        contactSuccess.innerHTML = tr(
          "Bedankt <b>" + escapeHtml(naam.value) + "</b>! Je bericht is verzonden. We nemen snel contact met je op.",
          "Thank you <b>" + escapeHtml(naam.value) + "</b>! Your message has been sent. We'll get back to you soon."
        ) + "<br><em style='color:var(--muted);font-style:normal;font-size:.85rem;'>" +
          tr("(Demo — nog niet gekoppeld aan e-mail/backend.)", "(Demo — not yet linked to email/backend.)") + "</em>";
        contactSuccess.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "center" });
      }
      contactForm.reset();
    });
  }

  /* ============================================================
     THEME TOGGLE (dark / light)
     ============================================================ */
  var THEME_KEY = "mk_theme";
  function applyTheme(tm) {
    document.documentElement.setAttribute("data-theme", tm);
    try { localStorage.setItem(THEME_KEY, tm); } catch (e) {}
    document.querySelectorAll("#themeToggle").forEach(function (b) {
      b.setAttribute("aria-label",
        tm === "dark" ? tr("Schakel naar licht thema", "Switch to light theme")
                      : tr("Schakel naar donker thema", "Switch to dark theme"));
      b.setAttribute("aria-pressed", tm === "light" ? "true" : "false");
    });
  }
  applyTheme(document.documentElement.getAttribute("data-theme") || "dark");
  document.querySelectorAll("#themeToggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
  });

  /* ============================================================
     LANGUAGE TOGGLE (nl / en)
     ============================================================ */
  var LANG_KEY = "mk_lang";
  var I18N_EN = {
    // Header / footer / shared
    "Naar inhoud": "To content",
    "Barbier · Zeist": "Barber · Zeist",
    "Kapsels": "Haircuts",
    "Galerij": "Gallery",
    "Prijzen": "Prices",
    "Afspraak maken": "Book now",
    "Inloggen": "Log in",
    "Diensten": "Services",
    "Knippen": "Haircut",
    "Knippen + Baard": "Haircut + Beard",
    "Hot Towel Scheren": "Hot Towel Shave",
    "Baard Modelleren": "Beard Shaping",
    "Kinderen": "Children",
    "MK Kapsalon · Alle rechten voorbehouden": "MK Kapsalon · All rights reserved",
    "Ontworpen met vakmanschap ·": "Crafted with care ·",
    "Voorwaarden": "Terms",
    "Welkom terug": "Welcome back",
    "Log in om je afspraken te beheren en sneller te boeken.": "Log in to manage your appointments and book faster.",
    "E-mailadres": "Email address",
    "Wachtwoord": "Password",
    "Wachtwoord vergeten?": "Forgot password?",
    "of": "or",
    "Nog geen account?": "No account yet?",
    "Registreren": "Sign up",
    "jij@voorbeeld.nl": "you@example.com",
    "Volledige naam": "Full name",
    // Home — hero
    "Turkse barbier in Zeist · Sinds 2020": "Turkish barber in Zeist · Since 2020",
    "Waar vakmanschap": "Where craftsmanship",
    "& verfijning": "& refinement",
    "samenkomen.": "come together.",
    "Bij MK Kapsalon draait alles om precisie, stijl en aandacht. Van een strakke fade tot een perfect gemodelleerde baard — u verlaat onze stoel als de beste versie van uzelf.": "At MK Kapsalon it's all about precision, style and attention. From a sharp fade to a perfectly shaped beard — you leave our chair as the best version of yourself.",
    "Bekijk kapsels": "View haircuts",
    "Google beoordeling*": "Google rating*",
    "5+ jaar": "5+ years",
    "Ervaring sinds 2020": "Experience since 2020",
    "welkom & op afspraak": "welcome & by appointment",
    "Vandaag geopend": "Open today",
    "Tot 18:00 · loop gerust binnen": "Until 18:00 · walk right in",
    // Home — marquee
    "Klassiek Knippen": "Classic Cut",
    "Kinderen Welkom": "Children Welcome",
    "Styling & Advies": "Styling & Advice",
    // Home — services
    "Diensten & Prijzen": "Services & Prices",
    "Behandelingen op maat": "Tailored treatments",
    "Elke service wordt uitgevoerd met premium producten en volle aandacht. Geen haast, geen compromis — alleen het resultaat dat u verdient.": "Every service is done with premium products and full attention. No rush, no compromise — only the result you deserve.",
    "Klassiek of modern, volledig afgestemd op jouw gezicht en stijl. Inclusief wassen & styling.": "Classic or modern, fully tailored to your face and style. Includes wash & styling.",
    "De complete verzorging. Haar en baard perfect op elkaar afgestemd voor een strak totaalbeeld.": "The complete treatment. Hair and beard perfectly matched for a sharp overall look.",
    "Contouren scherpstellen, trimmen en verzorgen met warme handdoek en olie.": "Sharpening contours, trimming and grooming with a warm towel and oil.",
    "Traditioneel scheermes, warme doek en huidverzorging. Een klassiek ritueel van top tot teen.": "Traditional razor, warm towel and skincare. A classic ritual from head to toe.",
    "Kinderen (t/m 12 jr)": "Children (up to 12 yrs)",
    "Geduldig, vriendelijk en op ooghoogte. Een fijne eerste ervaring bij de barbier.": "Patient, friendly and at eye level. A great first barber experience.",
    "Persoonlijk stylingadvies plus de juiste producten om je look thuis vast te houden.": "Personal styling advice plus the right products to keep your look at home.",
    "Bekijk de volledige prijslijst": "View the full price list",
    // Home — booking
    "Online afspraak": "Online booking",
    "Reserveer": "Book",
    "jouw stoel": "your chair",
    "Kies je dienst, barbier en tijd — in minder dan een minuut geregeld. Je ontvangt direct een bevestiging. Liever bellen? Dat kan natuurlijk ook.": "Choose your service, barber and time — sorted in under a minute. You'll receive an instant confirmation. Prefer to call? That works too, of course.",
    "Gratis annuleren tot 2 uur van tevoren": "Free cancellation up to 2 hours in advance",
    "Directe bevestiging via SMS": "Instant confirmation by SMS",
    "Kies je eigen vaste barbier": "Choose your own regular barber",
    "Dienst": "Service",
    "Kies een dienst": "Choose a service",
    "Knippen — € 25": "Haircut — € 25",
    "Knippen + Baard — € 35": "Haircut + Beard — € 35",
    "Baard Modelleren — € 17,50": "Beard Shaping — € 17,50",
    "Hot Towel Scheren — € 25": "Hot Towel Shave — € 25",
    "Kinderen (t/m 12 jr) — € 18": "Children (up to 12 yrs) — € 18",
    "Styling & Advies — € 10": "Styling & Advice — € 10",
    "Barbier": "Barber",
    "Kies een barbier": "Choose a barber",
    "Geen voorkeur": "No preference",
    "Datum": "Date",
    "Naam": "Name",
    "Telefoon": "Phone",
    "Tijd": "Time",
    "Toon tijden voor de gekozen dag. Grijze tijden zijn volgeboekt.": "Times shown for the selected day. Greyed-out times are fully booked.",
    "Bevestig afspraak": "Confirm booking",
    // Home — features
    "Waarom MK Kapsalon": "Why MK Kapsalon",
    "Meer dan een knipbeurt": "More than a haircut",
    "Echt vakmanschap": "True craftsmanship",
    "Ervaren barbiers die de klassieke technieken beheersen én de nieuwste trends volgen.": "Experienced barbers who master the classic techniques and follow the latest trends.",
    "Hygiëne voorop": "Hygiene first",
    "Voor elke klant vers gedesinfecteerd materiaal en een schone, verzorgde werkplek.": "Freshly disinfected tools for every client and a clean, tidy workspace.",
    "Premium producten": "Premium products",
    "We werken uitsluitend met kwaliteitsmerken voor huid, haar en baard.": "We work exclusively with quality brands for skin, hair and beard.",
    "Tijd voor jou": "Time for you",
    "Geen lopende band. We nemen de tijd om precies te leveren wat jij voor ogen hebt.": "No assembly line. We take the time to deliver exactly what you have in mind.",
    // Home — gallery teaser
    "Ons werk": "Our work",
    "Recente creaties": "Recent creations",
    "Een greep uit het werk van onze barbiers. Volg ons op Instagram voor meer.": "A glimpse of our barbers' work. Follow us on Instagram for more.",
    "Bekijk de volledige galerij": "View the full gallery",
    // Home — reviews
    "Wat klanten zeggen": "What clients say",
    "Beoordeeld met 4.9 / 5*": "Rated 4.9 / 5*",
    "\"Al jaren mijn vaste barbier. Altijd strak, altijd netjes en je wordt echt gehoord. Aanrader in Zeist.\"": "\"My regular barber for years. Always sharp, always neat and you're truly heard. Highly recommended in Zeist.\"",
    "Vaste klant": "Regular client",
    "\"Beste fade van de stad. Rustige sfeer, vakmensen en ze nemen echt de tijd. Online afspraak werkt top.\"": "\"Best fade in town. Relaxed vibe, real pros and they truly take their time. Online booking works great.\"",
    "\"Ging met mijn zoon en we zijn allebei super tevreden naar buiten gelopen. Kindvriendelijk en professioneel.\"": "\"Went with my son and we both left super happy. Child-friendly and professional.\"",
    "Nieuwe klant": "New client",
    "Lees alle reviews op Google": "Read all reviews on Google",
    // Home — visit
    "Bezoek ons": "Visit us",
    "Openingstijden & contact": "Opening hours & contact",
    "Openingstijden": "Opening hours",
    "Maandag": "Monday",
    "Dinsdag": "Tuesday",
    "Woensdag": "Wednesday",
    "Donderdag": "Thursday",
    "Vrijdag": "Friday",
    "Zaterdag": "Saturday",
    "Zondag": "Sunday",
    "Gesloten": "Closed",
    "Kom langs of bel": "Visit or call",
    "Adres": "Address",
    "E-mail": "Email",
    "Direct afspraak maken": "Book directly",
    "Waar vakmanschap en verfijning samenkomen om u te transformeren. Uw Turkse barbier in Zeist sinds 2020.": "Where craftsmanship and refinement come together to transform you. Your Turkish barber in Zeist since 2020.",
    // Kapsels page
    "Stijlgids": "Style guide",
    "Vind jouw": "Find your",
    "Twijfel je over je volgende kapsel? Laat je inspireren door onze meest gevraagde stijlen. Onze barbiers adviseren je graag over wat het beste past bij jouw haartype en gezichtsvorm.": "Not sure about your next haircut? Get inspired by our most requested styles. Our barbers are happy to advise on what suits your hair type and face shape best.",
    "De strakste overgang van huid naar haar. Scherp, modern en verrassend onderhoudsvriendelijk — onze meest gevraagde look.": "The sharpest transition from skin to hair. Sharp, modern and surprisingly low-maintenance — our most requested look.",
    "Populair": "Popular",
    "Kort": "Short",
    "Een subtiele, nette overgang rond de oren en nek. Tijdloos, verzorgd en geschikt voor elke gelegenheid.": "A subtle, neat transition around the ears and neck. Timeless, tidy and right for any occasion.",
    "Klassiek": "Classic",
    "Netjes": "Neat",
    "Pompadour & Quiff": "Pompadour & Quiff",
    "Volume naar boven en achter, met strak weggewerkte zijkanten. Karaktervol, stijlvol en vol persoonlijkheid.": "Volume up and back, with cleanly tapered sides. Full of character, style and personality.",
    "Stijlvol": "Stylish",
    "Slick Back & Baard": "Slick Back & Beard",
    "Achterover gekamd met een schone fade en volledig gemodelleerde baard. De complete, volwassen totaallook.": "Combed back with a clean fade and fully shaped beard. The complete, grown-up total look.",
    "Baard": "Beard",
    "Compleet": "Complete",
    "Een losse, getextureerde toplaag met een natuurlijke val. Casual, trendy en makkelijk te stylen.": "A loose, textured top with a natural fall. Casual, trendy and easy to style.",
    "Een klassieke scheiding, eventueel afgewerkt met een shaved line voor extra definitie en een scherpe finish.": "A classic parting, optionally finished with a shaved line for extra definition and a sharp finish.",
    "Scherp": "Sharp",
    "Curly & Krullen": "Curly & Curls",
    "Krullen strak in vorm gebracht met een schone fade. Je natuurlijke textuur, op zijn allermooist.": "Curls shaped up with a clean fade. Your natural texture at its very best.",
    "Krullen": "Curls",
    "Textuur": "Texture",
    "Hoogte behouden met strakke lijnen en optioneel haardesign. Een echte eyecatcher voor wie durft.": "Keep the height with sharp lines and optional hair design. A real eye-catcher for the bold.",
    "Kort, praktisch en altijd netjes. De ideale low-maintenance look die er nooit verkeerd uitziet.": "Short, practical and always neat. The ideal low-maintenance look that never looks wrong.",
    "Simpel": "Simple",
    "Speciaal voor onze jongste klanten: geduldig, vriendelijk en met een strak resultaat waar ze trots op zijn.": "Especially for our youngest clients: patient, friendly and with a sharp result they're proud of.",
    "t/m 12 jr": "up to 12 yrs",
    "Hoe werkt het": "How it works",
    "Van idee tot resultaat": "From idea to result",
    "Kies je stijl": "Choose your style",
    "Blader door de kapsels of laat je inspireren door onze galerij. Een foto meenemen mag altijd.": "Browse the haircuts or get inspired by our gallery. Bringing a photo is always welcome.",
    "Persoonlijk advies": "Personal advice",
    "Onze barbier kijkt naar je haartype en gezichtsvorm en adviseert wat écht bij je past.": "Our barber looks at your hair type and face shape and advises what truly suits you.",
    "Wij doen de rest": "We do the rest",
    "Achterover leunen en ontspannen. Jij verlaat de stoel als de beste versie van jezelf.": "Sit back and relax. You leave the chair as the best version of yourself.",
    "Weet je jouw look al?": "Already know your look?",
    "Reserveer je stoel bij MK Kapsalon en laat het vakwerk aan ons over.": "Book your chair at MK Kapsalon and leave the craft to us.",
    "Bekijk de galerij": "View the gallery",
    // Gallery page
    "Elke kapsel": "Every haircut",
    "een statement.": "a statement.",
    "Een selectie uit het werk van onze barbiers — van scherpe fades en getextureerde crops tot verzorgd baardwerk. Klik op een foto om te vergroten.": "A selection of our barbers' work — from sharp fades and textured crops to groomed beard work. Click a photo to enlarge.",
    "Kapsels per jaar*": "Haircuts per year*",
    "Volgers op Instagram": "Instagram followers",
    "Sinds 2020": "Since 2020",
    "In hartje Zeist": "In the heart of Zeist",
    "Alles": "All",
    "Volwassenen": "Adults",
    "Slick-back & Baard": "Slick-back & Beard",
    "Meer werk? Volg": "More work? Follow",
    "op Instagram.": "on Instagram.",
    "Klaar voor jouw beste look?": "Ready for your best look?",
    "Kies je dienst en barbier, en reserveer in minder dan een minuut.": "Choose your service and barber, and book in under a minute.",
    // Gallery captions
    "Slick-back met skin fade & verzorgde baard": "Slick-back with skin fade & groomed beard",
    "Quiff met strakke fade — jeugd": "Quiff with a sharp fade — youth",
    "High-top afro met scheerlijnen en fade": "High-top afro with shaved lines and fade",
    "Getextureerde crop met taper fade": "Textured crop with taper fade",
    "Side part met shaved line en fade": "Side part with shaved line and fade",
    "Krullen met nette drop fade": "Curls with a neat drop fade",
    "Korte crop met hard part en skin fade": "Short crop with hard part and skin fade",
    "Getextureerde slick-back met taper": "Textured slick-back with taper",
    "Klassieke korte crop cut": "Classic short crop cut",
    "Blonde side part met fade": "Blond side part with fade",
    // Prijzen page
    "Tarieven": "Rates",
    "Eerlijke prijzen,": "Fair prices,",
    "vakwerk gegarandeerd.": "craftsmanship guaranteed.",
    "Duidelijke tarieven zonder verrassingen. Elke behandeling is inclusief persoonlijk advies en de afwerking die je van een echte barbier verwacht.": "Clear rates with no surprises. Every treatment includes personal advice and the finish you expect from a real barber.",
    "Heren knippen": "Men's haircut",
    "Studenten": "Students",
    "op vertoon van pas": "on presentation of ID",
    "Senioren": "Seniors",
    "Tondeuse": "Clipper cut",
    "1 lengte, zonder schaar": "one length, no scissors",
    "Baard & Scheren": "Beard & Shave",
    "Baard modelleren": "Beard shaping",
    "Hot towel scheren": "Hot towel shave",
    "warme doek & olie": "warm towel & oil",
    "Snor trimmen": "Moustache trim",
    "Nekscheren": "Neck shave",
    "bijwerken": "touch-up",
    "Combinaties": "Combinations",
    "Knippen + Scheren": "Haircut + Shave",
    "Vader + Zoon": "Father + Son",
    "knippen, baard & styling": "haircut, beard & styling",
    "Kinderen & Extra's": "Children & Extras",
    "t/m 12 jaar": "up to 12 years",
    "Wassen + föhnen": "Wash + blow-dry",
    "Wenkbrauwen bijwerken": "Eyebrow touch-up",
    "Styling & advies": "Styling & advice",
    "Let op:": "Please note:",
    "dit zijn voorbeeldtarieven. Geef ons de definitieve prijslijst door, dan zetten we de exacte bedragen erin. Betalen kan met pin en contant.": "these are sample rates. Send us the final price list and we'll fill in the exact amounts. Payment by card and cash.",
    "Klaar om te reserveren?": "Ready to book?",
    "Kies je dienst en tijd, en verzeker je van jouw plek in de stoel.": "Choose your service and time, and secure your spot in the chair.",
    "Contact & route": "Contact & directions",
    // Contact page
    "Kom langs": "Drop by",
    "Tot ziens": "See you",
    "Loop gerust binnen of maak vooraf een afspraak. Heb je een vraag? Bel ons, of stuur een bericht via het formulier hieronder.": "Walk right in or book ahead. Have a question? Call us, or send a message via the form below.",
    "Stuur een bericht": "Send a message",
    "We reageren meestal binnen één werkdag.": "We usually reply within one business day.",
    "Bericht": "Message",
    "Verstuur bericht": "Send message",
    "Route plannen": "Get directions",
    "Liever meteen boeken?": "Prefer to book right away?",
    "Maak online een afspraak en kies zelf je barbier en tijd.": "Book online and choose your own barber and time.",
    "Bekijk prijzen": "View prices",
    "Waar kunnen we je mee helpen?": "How can we help you?"
  };

  var i18nText = [], i18nPh = [], i18nCap = [];
  function i18nBuild() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest("script,style,#openBadge,#timeSlots,#bookingSuccess,#contactSuccess,[data-noi18n]"))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) i18nText.push({ node: n, nl: n.nodeValue });
    document.querySelectorAll("[placeholder]").forEach(function (el) {
      i18nPh.push({ el: el, nl: el.getAttribute("placeholder") });
    });
    document.querySelectorAll("[data-caption]").forEach(function (el) {
      i18nCap.push({ el: el, nl: el.getAttribute("data-caption") });
    });
  }
  function i18nApply(lang) {
    i18nText.forEach(function (o) {
      if (lang === "en") {
        var en = I18N_EN[o.nl.replace(/\s+/g, " ").trim()];
        if (en != null) {
          o.node.nodeValue = o.nl.match(/^\s*/)[0] + en + o.nl.match(/\s*$/)[0];
        }
      } else {
        o.node.nodeValue = o.nl;
      }
    });
    i18nPh.forEach(function (o) {
      o.el.setAttribute("placeholder", lang === "en" ? (I18N_EN[o.nl.trim()] || o.nl) : o.nl);
    });
    i18nCap.forEach(function (o) {
      o.el.setAttribute("data-caption", lang === "en" ? (I18N_EN[o.nl.trim()] || o.nl) : o.nl);
    });
    document.documentElement.setAttribute("lang", lang);
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    document.querySelectorAll("#langToggle").forEach(function (b) {
      b.textContent = lang === "en" ? "NL" : "EN";
      b.setAttribute("aria-label", lang === "en" ? "Schakel naar Nederlands" : "Switch to English");
    });
    markHours();
    if (document.getElementById("timeSlots")) buildSlots();
  }
  i18nBuild();
  i18nApply(document.documentElement.getAttribute("lang") === "en" ? "en" : "nl");
  document.querySelectorAll("#langToggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      i18nApply(document.documentElement.getAttribute("lang") === "en" ? "nl" : "en");
    });
  });
})();
