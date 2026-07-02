//! Drift harness — Rust IPC layer (#302).
//!
//! Consumes the SAME golden fixture trees as the framework suite
//! (`packages/framework/__tests__/drift-harness.test.mjs`) and the desktop
//! vitest suite (`apps/desktop/src/utils/__tests__/driftHarnessFixtures.test.ts`):
//! canonical `.tiki/` workspaces under
//! `packages/shared/fixtures/tiki-workspaces/`, each with an `expected.json`
//! declaring what every layer must derive from it.
//!
//! This layer asserts the SERIALIZED IPC payloads (`serde_json::to_value`, the
//! same derived `Serialize` Tauri uses on the wire) of `get_state` /
//! `get_plan` / `load_tiki_releases` / `tiki_doctor` — generalizing the
//! #259/#278 struct-level guards to workspace level: a field that fails to
//! round-trip off a real tree fails here even when the in-memory struct looks
//! right. The drift-injection fixtures additionally pin that the #301 doctor
//! checks flag them and that the Fix commands (`archive_stale_plans` /
//! `archive_stale_release_defs`) heal exactly what the doctor reported.
//!
//! Install-channel ambience: fixture dirs deliberately contain no `.claude/`
//! or `.framework-version`, so `tiki_doctor` reports the canonical 4-script
//! floor in `unresolvedScriptPaths`, `copyInstallDetected:false`,
//! `reconcilerHookInstalled:false`, `frameworkVersion:null` — pinned once in
//! `doctor_ambient_install_fields_are_the_fixture_constants`. The vitest
//! summary test feeds NEUTRAL ambience (empty `unresolvedScriptPaths`) so
//! `expected.doctor.summary` isolates the DRIFT findings instead of drowning
//! them in install noise; the drift-relevant fields it feeds are exactly the
//! ones asserted here.

use crate::commands::{
    archive_stale_plans, archive_stale_release_defs, get_plan, get_state, load_tiki_releases,
    tiki_doctor,
};
use serde_json::Value;
use std::path::{Path, PathBuf};

const FIXTURE_NAMES: [&str; 9] = [
    "fresh-get",
    "mid-execute",
    "shipped-standalone",
    "shipped-release-child",
    "archived-release",
    "drift-dropped-transition",
    "drift-stale-active-plan",
    "drift-stale-active-def",
    "drift-ghost-release",
];

fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("shared")
        .join("fixtures")
        .join("tiki-workspaces")
}

fn tiki_dir(name: &str) -> PathBuf {
    fixtures_root().join(name).join("tiki")
}

fn tiki_str(name: &str) -> String {
    tiki_dir(name).to_string_lossy().to_string()
}

fn read_json(path: &Path) -> Value {
    let content = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("failed to read {:?}: {}", path, e));
    serde_json::from_str(&content).unwrap_or_else(|e| panic!("failed to parse {:?}: {}", path, e))
}

fn expected(name: &str) -> Value {
    read_json(&fixtures_root().join(name).join("expected.json"))
}

fn copy_dir_recursive(src: &Path, dst: &Path) {
    std::fs::create_dir_all(dst).unwrap();
    for entry in std::fs::read_dir(src).unwrap().flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to);
        } else {
            std::fs::copy(&from, &to).unwrap();
        }
    }
}

/// Copy a fixture's tiki tree into a unique temp dir; returns its path.
fn temp_copy(name: &str, tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dest = std::env::temp_dir().join(format!("tiki-drift-{}-{}", tag, nanos));
    copy_dir_recursive(&tiki_dir(name), &dest);
    dest
}

/// The serialized `get_state` payload for every fixture must carry each
/// expected activeWork entry's status / pipelineStep / phase / parentRelease
/// across the wire — the #259 lesson (a `skip_serializing` strips the field
/// from IPC even when the struct is right), asserted at workspace level.
#[test]
fn get_state_ipc_payload_matches_expected_for_every_fixture() {
    for name in FIXTURE_NAMES {
        let exp = expected(name);
        let state = get_state(Some(tiki_str(name)))
            .unwrap_or_else(|e| panic!("{}: get_state errored: {}", name, e))
            .unwrap_or_else(|| panic!("{}: get_state returned None", name));
        let payload = serde_json::to_value(&state).expect("TikiState must serialize");
        let active = payload["activeWork"]
            .as_object()
            .unwrap_or_else(|| panic!("{}: activeWork must serialize as an object", name));

        let exp_entries = exp["state"]["activeWork"].as_object().unwrap();
        assert_eq!(
            active.len(),
            exp_entries.len(),
            "{}: activeWork entry count",
            name
        );

        for (work_id, exp_entry) in exp_entries {
            let entry = active
                .get(work_id)
                .unwrap_or_else(|| panic!("{}: {} missing from payload", name, work_id));
            assert_eq!(
                entry["status"], exp_entry["status"],
                "{}: {} status",
                name, work_id
            );
            if !exp_entry["pipelineStep"].is_null() {
                assert_eq!(
                    entry["pipelineStep"], exp_entry["pipelineStep"],
                    "{}: {} pipelineStep",
                    name, work_id
                );
            }
            match &exp_entry["phase"] {
                Value::Null => {
                    // Explicit null in expected.json = phase must be ABSENT
                    // (cleared on completion, #220) or key not declared.
                    if exp_entry.as_object().unwrap().contains_key("phase") {
                        assert!(
                            entry.get("phase").is_none(),
                            "{}: {} phase must be absent, got {:?}",
                            name,
                            work_id,
                            entry.get("phase")
                        );
                    }
                }
                exp_phase => {
                    assert_eq!(
                        entry["phase"]["current"], exp_phase["current"],
                        "{}: {} phase.current",
                        name, work_id
                    );
                    assert_eq!(
                        entry["phase"]["total"], exp_phase["total"],
                        "{}: {} phase.total",
                        name, work_id
                    );
                    assert_eq!(
                        entry["phase"]["status"], exp_phase["status"],
                        "{}: {} phase.status",
                        name, work_id
                    );
                }
            }
            if !exp_entry["parentRelease"].is_null() {
                assert_eq!(
                    entry["parentRelease"], exp_entry["parentRelease"],
                    "{}: {} parentRelease must survive serialization",
                    name, work_id
                );
            }
        }
    }
}

/// `get_plan` payloads: phase statuses per expected.json, the archive
/// fallback (#266) for shipped issues, `None` when no plan exists anywhere,
/// and location honesty (an "archive" plan must not ALSO exist actively).
#[test]
fn get_plan_ipc_payload_and_archive_fallback_match_expected() {
    for name in FIXTURE_NAMES {
        let exp = expected(name);
        let Some(issues) = exp["issues"].as_object() else {
            continue;
        };
        for (num, exp_issue) in issues {
            let issue_number: u32 = num.parse().unwrap();
            let plan = get_plan(issue_number, Some(tiki_str(name)))
                .unwrap_or_else(|e| panic!("{}: get_plan(#{}) errored: {}", name, num, e));

            match exp_issue["planLocation"].as_str() {
                None => {
                    assert!(
                        plan.is_none(),
                        "{}: #{} must have no plan in either location",
                        name, num
                    );
                }
                Some(location) => {
                    let plan = plan
                        .unwrap_or_else(|| panic!("{}: get_plan(#{}) returned None", name, num));
                    let payload = serde_json::to_value(&plan).expect("TikiPlan must serialize");
                    let statuses: Vec<&str> = payload["phases"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|p| p["status"].as_str().unwrap())
                        .collect();
                    let exp_statuses: Vec<&str> = exp_issue["planPhaseStatuses"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|s| s.as_str().unwrap())
                        .collect();
                    assert_eq!(statuses, exp_statuses, "{}: #{} phase statuses", name, num);

                    // Location honesty: the file must live exactly where
                    // expected.json claims (this is what makes the archive
                    // fallback assertion meaningful for shipped fixtures).
                    let active = tiki_dir(name).join("plans").join(format!("issue-{}.json", num));
                    let archived = tiki_dir(name)
                        .join("plans")
                        .join("archive")
                        .join(format!("issue-{}.json", num));
                    match location {
                        "active" => assert!(
                            active.exists(),
                            "{}: #{} plan must be in the active location",
                            name, num
                        ),
                        "archive" => {
                            assert!(
                                archived.exists() && !active.exists(),
                                "{}: #{} plan must be archive-only (fallback path)",
                                name, num
                            );
                        }
                        other => panic!("{}: #{} unknown planLocation {:?}", name, num, other),
                    }
                }
            }
        }
    }
}

/// `load_tiki_releases(include_archived: true)`: version / location-derived
/// `archived` / on-disk `status` must match expected.json. archived-release
/// pins `archived:true` despite `status:"active"`; drift-stale-active-def pins
/// the reverse (`archived:false` despite a finished status) — the display
/// drift the doctor flags.
#[test]
fn load_tiki_releases_ipc_payload_matches_expected() {
    for name in FIXTURE_NAMES {
        let exp = expected(name);
        let releases = load_tiki_releases(Some(tiki_str(name)), Some(true))
            .unwrap_or_else(|e| panic!("{}: load_tiki_releases errored: {}", name, e));
        let exp_releases = exp["releases"].as_array().unwrap();
        assert_eq!(
            releases.len(),
            exp_releases.len(),
            "{}: release count",
            name
        );
        for exp_rel in exp_releases {
            let version = exp_rel["version"].as_str().unwrap();
            let rel = releases
                .iter()
                .find(|r| r.version == version)
                .unwrap_or_else(|| panic!("{}: release {} not loaded", name, version));
            // Serialize — the IPC wire format, not the in-memory struct.
            let payload = serde_json::to_value(rel).expect("TikiRelease must serialize");
            let expected_archived = exp_rel["location"] == "archive";
            assert_eq!(
                payload["archived"],
                Value::Bool(expected_archived),
                "{}: {} archived flag must be location-derived AND serialized",
                name,
                version
            );
            assert_eq!(
                payload["status"], exp_rel["status"],
                "{}: {} on-disk status field",
                name, version
            );
        }
    }
}

/// `tiki_doctor` payloads: state validity, activeWork count, per-release
/// checks, history/changelog↔def parity gaps, and the #301 stale-active-plan
/// findings must match expected.json for every fixture — including that the
/// drift-injection fixtures ARE flagged and the healthy ones are NOT. Also
/// pins `unverifiedShippedCriteria` empty: the fixtures' January timestamps
/// fall outside `UNVERIFIED_SC_MAX_AGE_DAYS`, so the shipped-standalone
/// visual SC left `verified:false` is deliberately aged out.
#[test]
fn tiki_doctor_findings_match_expected_for_every_fixture() {
    for name in FIXTURE_NAMES {
        let exp = expected(name);
        let exp_doctor = &exp["doctor"];
        let report = tiki_doctor(Some(tiki_str(name)))
            .unwrap_or_else(|e| panic!("{}: tiki_doctor errored: {}", name, e));
        let payload = serde_json::to_value(&report).expect("DiagnosticsReport must serialize");

        assert_eq!(
            payload["stateValid"], exp_doctor["stateValid"],
            "{}: stateValid",
            name
        );
        assert_eq!(
            payload["activeWorkCount"], exp_doctor["activeWorkCount"],
            "{}: activeWorkCount",
            name
        );
        assert_eq!(
            payload["recentReleasesMissingJson"], exp_doctor["recentReleasesMissingJson"],
            "{}: recentReleasesMissingJson",
            name
        );
        assert_eq!(
            payload["unverifiedShippedCriteria"], exp_doctor["unverifiedShippedCriteria"],
            "{}: unverifiedShippedCriteria (30-day cutoff must age out fixture SCs)",
            name
        );

        // releaseChecks: compare the full (version, location, status,
        // archivedButActive) tuples in order.
        let checks: Vec<(String, String, String, bool)> = payload["releaseChecks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                (
                    c["version"].as_str().unwrap().to_string(),
                    c["location"].as_str().unwrap().to_string(),
                    c["status"].as_str().unwrap().to_string(),
                    c["archivedButActive"].as_bool().unwrap(),
                )
            })
            .collect();
        let exp_checks: Vec<(String, String, String, bool)> = exp_doctor["releaseChecks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                (
                    c["version"].as_str().unwrap().to_string(),
                    c["location"].as_str().unwrap().to_string(),
                    c["status"].as_str().unwrap().to_string(),
                    c["archivedButActive"].as_bool().unwrap(),
                )
            })
            .collect();
        assert_eq!(checks, exp_checks, "{}: releaseChecks", name);

        // staleActivePlans: (issue, planPath) pairs in order.
        let stale: Vec<(u64, String)> = payload["staleActivePlans"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    p["issue"].as_u64().unwrap(),
                    p["planPath"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        let exp_stale: Vec<(u64, String)> = exp_doctor["staleActivePlans"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    p["issue"].as_u64().unwrap(),
                    p["planPath"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        assert_eq!(stale, exp_stale, "{}: staleActivePlans", name);
    }
}

/// Fixture dirs are workspaces, not installs: no `.claude/`, no
/// `.framework-version`. The doctor's install-channel fields are therefore
/// constant across every fixture — pinned here once so the vitest summary
/// layer's neutral-ambience substitution (empty `unresolvedScriptPaths`)
/// stays a documented, deliberate normalization instead of silent drift.
#[test]
fn doctor_ambient_install_fields_are_the_fixture_constants() {
    for name in FIXTURE_NAMES {
        let report = tiki_doctor(Some(tiki_str(name))).unwrap();
        let payload = serde_json::to_value(&report).unwrap();
        assert_eq!(payload["frameworkVersion"], Value::Null, "{}", name);
        assert_eq!(payload["copyInstallDetected"], Value::Bool(false), "{}", name);
        assert_eq!(
            payload["reconcilerHookInstalled"],
            Value::Bool(false),
            "{}",
            name
        );
        // No .claude/tiki/scripts/ next to a fixture tree => the canonical
        // 4-script floor is reported (see #268).
        let unresolved: Vec<&str> = payload["unresolvedScriptPaths"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap())
            .collect();
        assert_eq!(unresolved.len(), 4, "{}: canonical script floor", name);
        assert!(
            unresolved.iter().all(|p| p.starts_with(".claude/tiki/scripts/")),
            "{}: unresolved paths must be the canonical floor, got {:?}",
            name,
            unresolved
        );
    }
}

/// The `archiveStalePlans` Fix must heal EXACTLY what the doctor flagged in
/// the drift-stale-active-plan fixture: move the plan to `plans/archive/`,
/// normalize the stuck phase to completed, and leave a clean doctor report.
#[test]
fn archive_stale_plans_heals_the_stale_plan_fixture() {
    let tiki = temp_copy("drift-stale-active-plan", "heal-plan");
    let tiki_s = tiki.to_string_lossy().to_string();

    // Doctor flags exactly issue 77 pre-heal.
    let before = tiki_doctor(Some(tiki_s.clone())).unwrap();
    let before_payload = serde_json::to_value(&before).unwrap();
    assert_eq!(before_payload["staleActivePlans"][0]["issue"], 77);

    let moved = archive_stale_plans(Some(tiki_s.clone())).unwrap();
    assert_eq!(moved, 1, "exactly the flagged plan moves");

    assert!(!tiki.join("plans").join("issue-77.json").exists());
    let archived = read_json(&tiki.join("plans").join("archive").join("issue-77.json"));
    let statuses: Vec<&str> = archived["phases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["status"].as_str().unwrap())
        .collect();
    assert_eq!(
        statuses,
        vec!["completed", "completed"],
        "stuck executing phase must be normalized on archive"
    );

    let after = tiki_doctor(Some(tiki_s)).unwrap();
    let after_payload = serde_json::to_value(&after).unwrap();
    assert_eq!(
        after_payload["staleActivePlans"],
        serde_json::json!([]),
        "doctor must be clean after the Fix"
    );

    std::fs::remove_dir_all(&tiki).ok();
}

/// The `archiveStaleReleaseDefs` Fix must move the finished-status def out of
/// the active location, normalize its status to shipped, and flip the
/// location-derived `archived` flag (what `isReleaseCompleted` renders) to
/// true on the next load.
#[test]
fn archive_stale_release_defs_heals_the_stale_def_fixture() {
    let tiki = temp_copy("drift-stale-active-def", "heal-def");
    let tiki_s = tiki.to_string_lossy().to_string();

    // Pre-heal: the shipped release loads as NOT archived (renders live).
    let before = load_tiki_releases(Some(tiki_s.clone()), Some(true)).unwrap();
    assert!(!before.iter().find(|r| r.version == "v1.3.0").unwrap().archived);

    let moved = archive_stale_release_defs(Some(tiki_s.clone())).unwrap();
    assert_eq!(moved, 1, "exactly the stale def moves");

    assert!(!tiki.join("releases").join("v1.3.0.json").exists());
    let archived_def = read_json(&tiki.join("releases").join("archive").join("v1.3.0.json"));
    assert_eq!(archived_def["status"], "shipped", "status normalized on archive");

    let after = load_tiki_releases(Some(tiki_s.clone()), Some(true)).unwrap();
    assert!(
        after.iter().find(|r| r.version == "v1.3.0").unwrap().archived,
        "archived flag (the frontend's sole completed-signal) must flip true"
    );

    let doctor = tiki_doctor(Some(tiki_s)).unwrap();
    let payload = serde_json::to_value(&doctor).unwrap();
    let stale_defs: Vec<&str> = payload["releaseChecks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["location"] == "active" && c["status"] != "active")
        .map(|c| c["version"].as_str().unwrap())
        .collect();
    assert!(
        stale_defs.is_empty(),
        "no active-location finished-status defs may remain, got {:?}",
        stale_defs
    );

    std::fs::remove_dir_all(&tiki).ok();
}
