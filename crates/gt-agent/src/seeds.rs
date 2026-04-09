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
        id: "dept_leadership",
        name: "Leadership",
        description: "Owns global coordination, prioritization, and risk control.",
        order_index: 1,
    },
    DepartmentSeed {
        id: "dept_product_management",
        name: "Product Management",
        description: "Owns goals, scope, and acceptance criteria.",
        order_index: 2,
    },
    DepartmentSeed {
        id: "dept_delivery_engineering",
        name: "Delivery Engineering",
        description: "Owns implementation, integration, and technical delivery.",
        order_index: 3,
    },
    DepartmentSeed {
        id: "dept_quality_release",
        name: "Quality & Release",
        description: "Owns verification, release readiness, and rollback plans.",
        order_index: 4,
    },
];

pub const DEFAULT_ROLES: [RoleSeed; 4] = [
    RoleSeed {
        id: "global_role_manager",
        role_key: "manager",
        role_name: "Manager",
        department_id: "dept_leadership",
        charter_path: ".gtoffice/agents/roles/manager.md",
    },
    RoleSeed {
        id: "global_role_product",
        role_key: "product",
        role_name: "Product",
        department_id: "dept_product_management",
        charter_path: ".gtoffice/agents/roles/product.md",
    },
    RoleSeed {
        id: "global_role_build",
        role_key: "build",
        role_name: "Build",
        department_id: "dept_delivery_engineering",
        charter_path: ".gtoffice/agents/roles/build.md",
    },
    RoleSeed {
        id: "global_role_quality_release",
        role_key: "quality_release",
        role_name: "Quality & Release",
        department_id: "dept_quality_release",
        charter_path: ".gtoffice/agents/roles/quality_release.md",
    },
];
