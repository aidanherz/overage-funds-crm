/* ============================================================
   seed.js — Loads a handful of sample leads the very first time
   the app is opened, purely so there's something on screen to
   look at. Real uploads work exactly the same way once this
   sample data is cleared out (button lives in Settings).
   ============================================================ */

const Seed = {
  async maybeSeed() {
    const alreadySeeded = await DB.getSetting("hasSeeded", false);
    if (alreadySeeded) return;

    const leads = await DB.getAllLeads();
    if (leads.length > 0) {
      await DB.setSetting("hasSeeded", true);
      return;
    }

    const sample = Seed.buildSampleLeads();
    for (const lead of sample) {
      await DB.saveLead(lead);
    }
    await DB.setSetting("hasSeeded", true);
    await DB.setSetting("sampleDataLoaded", true);
  },

  buildSampleLeads() {
    const now = new Date();
    const monthsAgo = (n) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() - n);
      return Parser.toISODate(d);
    };

    const base = (overrides) => ({
      id: uid("lead"),
      state: "",
      county: "",
      listType: "Surplus Funds",
      sourceOffice: "County Treasurer",
      propertyAddress: "",
      parcelNumber: "",
      saleDate: "",
      overageAmount: 0,
      formerOwnerName: "",
      status: "New",
      nextAction: "",
      responsible: "",
      dueDate: "",
      countyFollowUpDate: "",
      claimantFollowUpDate: "",
      researchNotes: "",
      skipTraceNotes: "",
      isDisqualified: false,
      disqualifyReasons: [],
      milestones: {
        notaryHired: { done: false, date: "" },
        signingCompleted: { done: false, date: "" },
        docsReceived: { done: false, date: "" },
        submissionSent: { done: false, date: "" },
        decisionMade: { done: false, date: "", notes: "" },
        checkReceived: { done: false, date: "", amount: "" },
        checkSent: { done: false, date: "" },
      },
      activityLog: [],
      expenses: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    });

    return [
      base({
        state: "Georgia",
        county: "Fulton",
        propertyAddress: "482 Peachtree Rd, Atlanta, GA",
        parcelNumber: "14F-0021-LL-032",
        saleDate: monthsAgo(14),
        overageAmount: 18450,
        formerOwnerName: "Marcus Whitfield",
        status: "Researching",
        nextAction: "Run skip trace",
        responsible: "You",
        dueDate: Parser.toISODate(new Date(now.getTime() + 3 * 86400000)),
        researchNotes: "Confirmed on Fulton County surplus funds list dated last quarter.",
      }),
      base({
        state: "Georgia",
        county: "Fulton",
        propertyAddress: "119 Maple Ct, Alpharetta, GA",
        parcelNumber: "22-0391-002",
        saleDate: monthsAgo(30),
        overageAmount: 6200,
        formerOwnerName: "Denise Carrow",
        status: "Contact Made",
        nextAction: "Send engagement letter",
        responsible: "You",
        dueDate: Parser.toISODate(new Date(now.getTime() + 6 * 86400000)),
      }),
      base({
        state: "Georgia",
        county: "DeKalb",
        propertyAddress: "77 Rockbridge Rd, Stone Mountain, GA",
        parcelNumber: "16-102-05-018",
        saleDate: monthsAgo(9),
        overageAmount: 950,
        formerOwnerName: "Harold Yates",
        status: "New",
        isDisqualified: true,
        disqualifyReasons: ["Too small (amount is under $1,000)"],
      }),
      base({
        state: "Texas",
        county: "Harris",
        propertyAddress: "3301 Winrock Blvd, Houston, TX",
        parcelNumber: "0451870000012",
        saleDate: monthsAgo(3),
        overageAmount: 24500,
        formerOwnerName: "Angela Reyes",
        status: "New",
        isDisqualified: true,
        disqualifyReasons: ["Too new (sale was 3 month(s) ago; minimum is 6)"],
      }),
      base({
        state: "Texas",
        county: "Harris",
        propertyAddress: "908 Bellaire Blvd, Houston, TX",
        parcelNumber: "0129440000045",
        saleDate: monthsAgo(20),
        overageAmount: 41200,
        formerOwnerName: "James O'Connell",
        status: "Docs Sent",
        nextAction: "Follow up on signed packet",
        responsible: "You",
        dueDate: Parser.toISODate(new Date(now.getTime() - 1 * 86400000)),
        milestones: {
          notaryHired: { done: true, date: monthsAgo(1) },
          signingCompleted: { done: false, date: "" },
          docsReceived: { done: false, date: "" },
          submissionSent: { done: false, date: "" },
          decisionMade: { done: false, date: "", notes: "" },
          checkReceived: { done: false, date: "", amount: "" },
          checkSent: { done: false, date: "" },
        },
        activityLog: [
          {
            id: uid("log"),
            date: monthsAgo(1),
            type: "Letter Sent",
            who: "You",
            notes: "Mailed engagement packet via certified mail.",
          },
        ],
      }),
      base({
        state: "Florida",
        county: "Orange",
        propertyAddress: "2100 S Semoran Blvd, Orlando, FL",
        parcelNumber: "29-22-30-1234-00-560",
        saleDate: monthsAgo(52),
        overageAmount: 12300,
        formerOwnerName: "Patricia Nguyen",
        status: "Submitted to County",
        nextAction: "Follow up with county clerk",
        responsible: "You",
        dueDate: Parser.toISODate(new Date(now.getTime() + 10 * 86400000)),
      }),
      base({
        state: "Florida",
        county: "Orange",
        propertyAddress: "555 Curry Ford Rd, Orlando, FL",
        parcelNumber: "18-23-29-0000-01-002",
        saleDate: monthsAgo(65),
        overageAmount: 3800,
        formerOwnerName: "Unknown / Estate",
        status: "New",
        isDisqualified: true,
        disqualifyReasons: ["Too old (sale was over 5 year(s) ago)"],
      }),
    ];
  },
};
