# NextApply — Articles SEO Audit & Optimization Plan
**Site:** https://nextapply.co.uk · **Audit date:** 19 October 2026 · **Articles found:** 42 (all live)

---

## 1. Critical finding (read this first)

The 42 articles exist and return 200 OK, but:

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | `/articles` index page shows "No articles yet" although 42 articles are live | 🔴 Critical | Fix the Firestore fetch/render on the articles index |
| 2 | `sitemap.xml` contains **zero** `/articles/` URLs (604 URLs total) | 🔴 Critical | Generate article URLs into the sitemap |
| 3 | Articles are linked from only some opportunity pages | 🟠 High | Add programmatic "Related guides" block on every opportunity page |
| 4 | Most articles are 500–900 words — thin for competitive keywords | 🟠 High | Expand top 15 priority articles to 1,200–2,000 words (drafts below show the format) |
| 5 | No visible "Last updated" date signal found on articles | 🟡 Medium | Show `updatedAt` on the article template |

**Do items 1 and 2 before anything else.** Without sitemap + index, no amount of content work will rank.

---

## 2. Content verdict

**What's already good (keep it):**
- Genuinely human, practical tone — no AI filler. This is an E-E-A-T asset.
- Accurate, cautious statements ("check the official source") match the NextApply brand USP.
- FAQ sections on articles, official guidance links, and a "Relevant listings on NextApply" section.

**What to improve:**
1. **Answer-first opening:** first 50 words should directly answer the search query (AI Overviews + featured snippets).
2. **Comparison tables:** funding amounts, deadlines, test scores → tables win snippets.
3. **Mid-content internal links:** currently links sit at the end. Add 2–3 contextual links in the first half of each article.
4. **Years and numbers in titles** for time-sensitive keywords (scholarships, salaries, visas).
5. **Depth:** expand priority articles to 1,200–2,000 words with the structure used in the drafts.

---

## 3. Priority order (which articles to expand first)

**Tier 1 — highest traffic potential (expand first):**
1. `daad-scholarships-international-students-complete-guide` → draft written ✅
2. `phd-salary-stipend-comparison-by-country-2027` → draft written ✅
3. `study-in-germany-for-free-complete-guide-2027` → draft written ✅
4. `how-to-email-phd-supervisor-uk-7-templates` — already strong (1,500w); only add internal links + year in title
5. `how-to-read-phd-job-advertisement-before-applying` — strong (2,000w); add links
6. `how-to-apply-masters-phd-uk-official-links` — strong (2,000w); add links
7. `masters-in-europe-without-ielts` — high-volume keyword, only 789 words → expand
8. `uk-vs-germany-vs-netherlands-phd-comparison-2027` — comparison keyword, add full comparison table
9. `ielts-vs-toefl-vs-pte-uk-phd-2027` — add score-conversion table
10. `student-visa-uk-2027-financial-requirements-atas-graduate-route` — add £ amounts table

**Tier 2:** documents cluster (CV, cover letter, motivation letter, SOP, recommendation, proposal, interview) — interlink all 7 as a "Application Documents" series with prev/next navigation.

**Tier 3:** niche/profile articles (low CGPA, academic gap, backlogs, without masters, without publications) — expand slightly, keep as-is otherwise.

---

## 4. Article-by-article optimization table

Format: slug → **recommended title (≤60 chars)** · primary keyword · target words · cluster links to add

### Cluster: Funding & Scholarships
| Slug | New title | Keyword | Words |
|---|---|---|---|
| daad-scholarships-international-students-complete-guide | DAAD Scholarship 2027–28 for International Students: Complete Guide | daad scholarship international students | 1,800 |
| phd-salary-stipend-comparison-by-country-2027 | PhD Stipend & Salary Comparison by Country (2027 Rates) | phd stipend comparison by country | 1,600 |
| study-in-germany-for-free-complete-guide-2027 | Study in Germany for Free (2027): Fees, Costs & Funding | study in germany for free | 1,800 |
| scholarship-deadline-passed-can-you-still-apply | Missed a Scholarship Deadline? 5 Things You Can Still Do | scholarship deadline passed | 900 |
| why-scholarship-applications-get-rejected-12-reasons | 12 Reasons Scholarship Applications Get Rejected | why scholarship applications get rejected | 1,200 |
| what-does-self-funded-phd-mean-costs-funding-alternatives | What Is a Self-Funded PhD? Costs & Funding Alternatives | self-funded phd | 1,100 |

### Cluster: UK PhD, Visa & After-Study
| Slug | New title | Keyword | Words |
|---|---|---|---|
| student-visa-uk-2027-financial-requirements-atas-graduate-route | UK Student Visa 2027: Financial Requirements, ATAS & Graduate Route | uk student visa financial requirements | 1,600 |
| how-to-apply-uk-student-visa-step-by-step-2026-2027 | UK Student Visa: Step-by-Step Application (2026–27) | uk student visa application step by step | 1,300 |
| can-international-students-work-during-phd-uk | Can International Students Work During a PhD in the UK? | work during phd uk international students | 1,000 |
| graduate-route-vs-psw-vs-opt-working-abroad-2027 | Graduate Route vs OPT vs Post-Study Work Visas (2027) | graduate route vs opt | 1,200 |
| pr-pathways-after-study-canada-australia-germany-uk | PR Pathways After Study: UK, Canada, Australia, Germany | pr after study abroad | 1,200 |
| student-accommodation-uk-halls-private-homestay-2027 | UK Student Accommodation: Halls vs Private vs Homestay (2027) | uk student accommodation cost | 1,100 |
| how-to-apply-masters-phd-uk-official-links | How to Apply for a Master's or PhD in the UK (Official Links) | how to apply phd uk | 2,000 |

### Cluster: Application Documents (link all to each other as a series)
| Slug | New title | Keyword | Words |
|---|---|---|---|
| how-to-write-academic-cv-phd-applications-sample | Academic CV for PhD Applications: Structure + Example | academic cv phd application | 1,700 |
| how-to-write-cover-letter-phd-application-sample | PhD Cover Letter: Structure + Sample | phd cover letter sample | 1,200 |
| how-to-write-motivation-letter-european-universities-sample | Motivation Letter for European Universities: Template + Sample | motivation letter european university | 1,300 |
| masters-personal-statement-uk-examples | UK Master's Personal Statement: Structure + Examples | personal statement uk masters | 1,300 |
| sop-vs-personal-statement-vs-research-proposal | SOP vs Personal Statement vs Research Proposal | sop vs personal statement | 1,000 |
| how-to-request-letter-of-recommendation-email-templates | Recommendation Letter Request: Email Templates | how to ask for recommendation letter | 1,100 |
| phd-research-proposal-europe-structure-sample-pdf | PhD Research Proposal for Europe: Structure + Example | phd research proposal sample europe | 1,600 |
| phd-interview-questions-answers-research-interview | PhD Interview Questions and Answers (Research Interview) | phd interview questions | 1,500 |

### Cluster: Supervisor & Applications
| Slug | New title | Keyword | Words |
|---|---|---|---|
| how-to-email-phd-supervisor-uk-7-templates | How to Email a PhD Supervisor: 7 Templates (2027) | email phd supervisor template | 1,500 |
| how-to-follow-up-phd-supervisor-does-not-reply | PhD Supervisor Not Replying? How to Follow Up Properly | phd supervisor not replying | 900 |
| how-to-read-phd-job-advertisement-before-applying | How to Read a PhD Job Advert Before Applying | phd job advert | 2,000 |
| masters-phd-application-timeline-12-months | 12-Month Application Timeline for Master's & PhD | study abroad application timeline | 1,000 |
| phd-application-rejected-what-next | PhD Application Rejected? What to Do Next | phd application rejected | 900 |
| how-to-identify-funded-phd-accepts-international-students | Is This PhD Really Funded for International Students? | fully funded phd international students | 1,100 |
| can-you-apply-phd-without-masters-degree | Can You Apply for a PhD Without a Master's? | phd without masters | 1,100 |
| phd-in-europe-without-publications | PhD in Europe Without Publications: What's Possible | phd without publications | 1,100 |

### Cluster: Profile & Eligibility
| Slug | New title | Keyword | Words |
|---|---|---|---|
| low-cgpa-backlogs-study-abroad-guide | Low CGPA or Backlogs? Study Abroad Realistically | study abroad with low cgpa | 1,100 |
| cgpa-to-uk-degree-classification | CGPA to UK Degree Classification: How Universities Judge It | cgpa to uk classification | 900 |
| how-to-explain-academic-gap-university-application | How to Explain an Academic Gap in Your Application | academic gap explanation | 1,400 |
| ielts-vs-toefl-vs-pte-uk-phd-2027 | IELTS vs TOEFL vs PTE for a UK PhD (2027) | ielts vs toefl vs pte | 1,300 |
| masters-in-europe-without-ielts | Master's in Europe Without IELTS: Real Waiver Rules | masters in europe without ielts | 1,500 |

### Cluster: Country Comparisons & Salaries
| Slug | New title | Keyword | Words |
|---|---|---|---|
| uk-vs-germany-vs-netherlands-phd-comparison-2027 | UK vs Germany vs Netherlands: PhD Comparison (2027) | phd in uk vs germany vs netherlands | 1,600 |
| phd-salary-germany-tv-l-e13-explained | TV-L E13 PhD Salary in Germany Explained (2027) | tv-l e13 phd salary | 1,000 |
| phd-in-netherlands-employee-salary-contract | PhD in the Netherlands: Salary, Contract & Funding | phd salary netherlands | 1,100 |
| cost-of-living-phd-students-netherlands-germany-uk-2027 | PhD Cost of Living: UK, Germany & Netherlands (2027) | phd cost of living comparison | 1,400 |
| blocked-account-germany-student-visa-guide | German Blocked Account for the Student Visa (2027 Guide) | blocked account germany student visa | 1,100 |
| graduate-route-vs-psw-vs-opt-working-abroad-2027 | Graduate Route vs OPT vs Other Post-Study Visas (2027) | graduate route vs opt | 1,200 |

### Cluster: Humanoid Robotics niche
| Slug | New title | Keyword | Words |
|---|---|---|---|
| humanoid-robotics-phd-proposal-guide | Humanoid Robotics PhD Proposal: How to Write One | humanoid robotics phd | 1,000 |
| humanoid-robotics-phd-research-topics | 12 Humanoid Robotics PhD Research Topics (2027) | humanoid robotics research topics | 1,200 |
| humanoid-robotics-portfolio-msc-phd | Robotics Portfolio for MSc & PhD Applications | robotics portfolio phd | 900 |

---

## 5. Internal linking map (add to every article)

Every article must contain:
1. **1 contextual link in the top half** to its cluster hub or a sibling article
2. **2–4 links at the end** ("Related guides" block — same cluster)
3. **1–3 links to live opportunity pages** (see `public/data/opportunities/` — 550+ slugs available)

Key hubs:
- **Funding hub:** DAAD guide ↔ stipend comparison ↔ self-funded phd ↔ rejected-12-reasons ↔ deadline-passed
- **UK hub:** student visa 2027 ↔ apply UK step-by-step ↔ work during PhD ↔ graduate route ↔ accommodation
- **Documents series (order):** CV → cover letter → motivation letter/personal statement → SOP-vs-PS-vs-RP → recommendation letter → research proposal → interview
- **Country hub:** UK vs DE vs NL ↔ cost of living ↔ stipend comparison ↔ TV-L E13 ↔ NL employment ↔ blocked account ↔ Germany free guide

Opportunity pages to link from funding articles:
- `/scholarship-daad-germany` (DAAD article)
- `/gates-cambridge-scholarship-2027-fully-funded`, `/rhodes-scholarship-2027-oxford-fully-funded` (stipend comparison)
- `/scholarship-chevening-uk-government`, `/fully-funded-commonwealth-masters-scholarships-for-study-in-the-uk` (UK articles)
- `/phd-mext-university-recommendation-japan`, `/max-planck-internship-2027-germany-fully-funded-research-program` (Germany/Asia articles)

## 6. Publishing workflow after fixes

1. Publish updated article → Search Console URL inspection → Request indexing
2. Update `lastmod` in sitemap on every update (freshness signal)
3. Re-check rankings after 4–6 weeks before expanding further

## 7. Missing articles to write next (new content)

1. Chevening Scholarship 2027–28: Complete Guide (links to `/scholarship-chevening-uk-government`)
2. Commonwealth Scholarships 2027: Master's & PhD Guide (links to `/fully-funded-commonwealth-masters-scholarships-for-study-in-the-uk`)
3. Gates Cambridge vs Rhodes vs Chevening: Which Should You Apply For?
4. MEXT Scholarship Guide: Embassy vs University Recommendation (links to `/phd-mext-university-recommendation-japan`)
5. Erasmus Mundus vs Direct Master's in Europe
