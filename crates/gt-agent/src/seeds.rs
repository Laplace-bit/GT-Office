#[derive(Debug, Clone)]
pub struct DepartmentSeed {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub order_index: i32,
}

#[derive(Debug, Clone)]
pub struct RoleSeed {
    pub id: &'static str,
    pub role_key: &'static str,
    pub role_name: &'static str,
    pub department_id: &'static str,
    pub charter_path: &'static str,
}

pub const DEFAULT_DEPARTMENTS: [DepartmentSeed; 4] = [
    DepartmentSeed {
        id: "dept_orchestration",
        name: "Orchestration",
        description: "Task decomposition, dispatch, and progress tracking.",
        order_index: 1,
    },
    DepartmentSeed {
        id: "dept_analysis",
        name: "Analysis",
        description: "Codebase intelligence and structured context.",
        order_index: 2,
    },
    DepartmentSeed {
        id: "dept_generation",
        name: "Generation",
        description: "Feature implementation and artifact production.",
        order_index: 3,
    },
    DepartmentSeed {
        id: "dept_evaluation",
        name: "Evaluation",
        description: "Output verification and quality assessment.",
        order_index: 4,
    },
];

pub const DEFAULT_ROLES: [RoleSeed; 4] = [
    RoleSeed {
        id: "global_role_orchestrator",
        role_key: "orchestrator",
        role_name: "Orchestrator",
        department_id: "dept_orchestration",
        charter_path: ".gtoffice/agents/roles/orchestrator.md",
    },
    RoleSeed {
        id: "global_role_analyst",
        role_key: "analyst",
        role_name: "Analyst",
        department_id: "dept_analysis",
        charter_path: ".gtoffice/agents/roles/analyst.md",
    },
    RoleSeed {
        id: "global_role_generator",
        role_key: "generator",
        role_name: "Generator",
        department_id: "dept_generation",
        charter_path: ".gtoffice/agents/roles/generator.md",
    },
    RoleSeed {
        id: "global_role_evaluator",
        role_key: "evaluator",
        role_name: "Evaluator",
        department_id: "dept_evaluation",
        charter_path: ".gtoffice/agents/roles/evaluator.md",
    },
];