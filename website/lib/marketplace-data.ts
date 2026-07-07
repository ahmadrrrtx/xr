// Auto-generated from /skills for XR Marketplace website.
// Do not edit by hand; regenerate from skills manifests when Skill packs change.

export type MarketplaceSkill = {
  id: string; name: string; version: string; description: string; longDescription?: string;
  publisher: string; license: string; categories: string[]; tags: string[]; keywords: string[];
  verification: string; permissions: Array<{ scope: string; reason?: string; dangerous?: boolean; optional?: boolean }>;
  dependencies: Array<{ kind: string; id: string; version?: string; optional?: boolean; reason?: string }>;
  commands: Array<{ name: string; title?: string; description?: string; prompt?: string }>;
  workflows: Array<{ id: string; title: string; description?: string; steps?: Array<{ id: string; title: string; instruction: string; expectedOutput?: string }> }>;
  memoryTemplates: Array<{ id: string; category: string; contentTemplate: string; scope?: string; importance?: number }>;
  docs: string[]; examples: string[]; tests: string[]; kind: string; installCommand: string;
};

export const marketplaceSkills = [
  {
    "id": "academic_research",
    "name": "Academic Research",
    "version": "1.0.0",
    "description": "Academic Research delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.",
    "longDescription": "Academic Research delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "research"
    ],
    "tags": [
      "academic",
      "literature",
      "citations",
      "methodology"
    ],
    "keywords": [
      "academic",
      "literature",
      "citations",
      "methodology",
      "academic research",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "net",
        "reason": "Academic Research may need web access for source discovery through XR egress controls.",
        "dangerous": true
      },
      {
        "scope": "fs:write",
        "reason": "Academic Research may save reports after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "academic-research",
        "title": "Academic Research",
        "description": "Apply the Academic Research skill to a task.",
        "prompt": "Use the Academic Research skill and produce professional, validated output."
      },
      {
        "name": "academic-research-doctor",
        "title": "Academic Research Doctor",
        "description": "Run the Academic Research Skill quality and readiness checklist.",
        "prompt": "Use Academic Research to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "academic-research",
        "title": "/academic-research",
        "description": "Invoke Academic Research.",
        "prompt": "Invoke the Academic Research skill."
      },
      {
        "name": "academic-research-doctor",
        "title": "/academic-research-doctor",
        "description": "Diagnose readiness with Academic Research.",
        "prompt": "Run Academic Research diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "academic_research:workflow",
        "title": "Academic Research Professional Workflow",
        "description": "Default workflow for Academic Research.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "academic_research:professional-delivery",
        "title": "Academic Research Professional Delivery",
        "description": "End-to-end professional workflow for Academic Research.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Frame the research question, audience, scope, and decision to support.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Plan source strategy across primary, secondary, and contradictory evidence.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Extract claims, methods, dates, metrics, and limitations.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Synthesize findings with confidence and alternative interpretations.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver conclusions, open questions, and recommended next research steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "academic_research:quality-gate",
        "title": "Academic Research Quality Gate",
        "description": "Pre-final validation gate for Academic Research.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "academic_research:prefs",
        "category": "workflow",
        "contentTemplate": "For Academic Research, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "academic_research:standards",
        "category": "workflow",
        "contentTemplate": "When using Academic Research, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "academic_research:handoff",
        "category": "workflow",
        "contentTemplate": "When Academic Research finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install academic_research"
  },
  {
    "id": "architecture_reviewer",
    "name": "Architecture Reviewer",
    "version": "1.0.0",
    "description": "Architecture Reviewer delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Architecture Reviewer delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "architecture",
      "review",
      "systems",
      "tradeoffs"
    ],
    "keywords": [
      "architecture",
      "review",
      "systems",
      "tradeoffs",
      "architecture reviewer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Architecture Reviewer may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Architecture Reviewer may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Architecture Reviewer may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "architecture-reviewer",
        "title": "Architecture Reviewer",
        "description": "Apply the Architecture Reviewer skill to a task.",
        "prompt": "Use the Architecture Reviewer skill and produce professional, validated output."
      },
      {
        "name": "architecture-reviewer-doctor",
        "title": "Architecture Reviewer Doctor",
        "description": "Run the Architecture Reviewer Skill quality and readiness checklist.",
        "prompt": "Use Architecture Reviewer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "architecture-reviewer",
        "title": "/architecture-reviewer",
        "description": "Invoke Architecture Reviewer.",
        "prompt": "Invoke the Architecture Reviewer skill."
      },
      {
        "name": "architecture-reviewer-doctor",
        "title": "/architecture-reviewer-doctor",
        "description": "Diagnose readiness with Architecture Reviewer.",
        "prompt": "Run Architecture Reviewer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "architecture_reviewer:workflow",
        "title": "Architecture Reviewer Professional Workflow",
        "description": "Default workflow for Architecture Reviewer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "architecture_reviewer:professional-delivery",
        "title": "Architecture Reviewer Professional Delivery",
        "description": "End-to-end professional workflow for Architecture Reviewer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "architecture_reviewer:quality-gate",
        "title": "Architecture Reviewer Quality Gate",
        "description": "Pre-final validation gate for Architecture Reviewer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "architecture_reviewer:prefs",
        "category": "workflow",
        "contentTemplate": "For Architecture Reviewer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "architecture_reviewer:standards",
        "category": "workflow",
        "contentTemplate": "When using Architecture Reviewer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "architecture_reviewer:handoff",
        "category": "workflow",
        "contentTemplate": "When Architecture Reviewer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install architecture_reviewer"
  },
  {
    "id": "brand_designer",
    "name": "Brand Designer",
    "version": "1.0.0",
    "description": "Brand Designer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.",
    "longDescription": "Brand Designer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "creative"
    ],
    "tags": [
      "brand",
      "identity",
      "voice",
      "positioning"
    ],
    "keywords": [
      "brand",
      "identity",
      "voice",
      "positioning",
      "brand designer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Brand Designer may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "brand-designer",
        "title": "Brand Designer",
        "description": "Apply the Brand Designer skill to a task.",
        "prompt": "Use the Brand Designer skill and produce professional, validated output."
      },
      {
        "name": "brand-designer-doctor",
        "title": "Brand Designer Doctor",
        "description": "Run the Brand Designer Skill quality and readiness checklist.",
        "prompt": "Use Brand Designer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "brand-designer",
        "title": "/brand-designer",
        "description": "Invoke Brand Designer.",
        "prompt": "Invoke the Brand Designer skill."
      },
      {
        "name": "brand-designer-doctor",
        "title": "/brand-designer-doctor",
        "description": "Diagnose readiness with Brand Designer.",
        "prompt": "Run Brand Designer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "brand_designer:workflow",
        "title": "Brand Designer Professional Workflow",
        "description": "Default workflow for Brand Designer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "brand_designer:professional-delivery",
        "title": "Brand Designer Professional Delivery",
        "description": "End-to-end professional workflow for Brand Designer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Define audience, goal, brand/taste direction, constraints, and deliverable format.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Explore creative territories and select a coherent direction.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Produce polished draft artifacts with rationale.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Critique against audience, clarity, originality, and conversion/usability.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver final version plus variants, usage guidance, and next iteration ideas.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "brand_designer:quality-gate",
        "title": "Brand Designer Quality Gate",
        "description": "Pre-final validation gate for Brand Designer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "brand_designer:prefs",
        "category": "workflow",
        "contentTemplate": "For Brand Designer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "brand_designer:standards",
        "category": "workflow",
        "contentTemplate": "When using Brand Designer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "brand_designer:handoff",
        "category": "workflow",
        "contentTemplate": "When Brand Designer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install brand_designer"
  },
  {
    "id": "crm_assistant",
    "name": "CRM Assistant",
    "version": "1.0.0",
    "description": "CRM Assistant delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "CRM Assistant delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "crm",
      "customer",
      "pipeline",
      "ops"
    ],
    "keywords": [
      "crm",
      "customer",
      "pipeline",
      "ops",
      "crm assistant",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "CRM Assistant may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "crm-assistant",
        "title": "CRM Assistant",
        "description": "Apply the CRM Assistant skill to a task.",
        "prompt": "Use the CRM Assistant skill and produce professional, validated output."
      },
      {
        "name": "crm-assistant-doctor",
        "title": "CRM Assistant Doctor",
        "description": "Run the CRM Assistant Skill quality and readiness checklist.",
        "prompt": "Use CRM Assistant to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "crm-assistant",
        "title": "/crm-assistant",
        "description": "Invoke CRM Assistant.",
        "prompt": "Invoke the CRM Assistant skill."
      },
      {
        "name": "crm-assistant-doctor",
        "title": "/crm-assistant-doctor",
        "description": "Diagnose readiness with CRM Assistant.",
        "prompt": "Run CRM Assistant diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "crm_assistant:workflow",
        "title": "CRM Assistant Professional Workflow",
        "description": "Default workflow for CRM Assistant.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "crm_assistant:professional-delivery",
        "title": "CRM Assistant Professional Delivery",
        "description": "End-to-end professional workflow for CRM Assistant.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "crm_assistant:quality-gate",
        "title": "CRM Assistant Quality Gate",
        "description": "Pre-final validation gate for CRM Assistant.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "crm_assistant:prefs",
        "category": "workflow",
        "contentTemplate": "For CRM Assistant, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "crm_assistant:standards",
        "category": "workflow",
        "contentTemplate": "When using CRM Assistant, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "crm_assistant:handoff",
        "category": "workflow",
        "contentTemplate": "When CRM Assistant finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install crm_assistant"
  },
  {
    "id": "code_auditor",
    "name": "Code Auditor",
    "version": "1.0.0",
    "description": "Code Auditor delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.",
    "longDescription": "Code Auditor delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "security"
    ],
    "tags": [
      "code-audit",
      "secure-code",
      "review",
      "sast"
    ],
    "keywords": [
      "code-audit",
      "secure-code",
      "review",
      "sast",
      "code auditor",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Code Auditor may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "code-auditor",
        "title": "Code Auditor",
        "description": "Apply the Code Auditor skill to a task.",
        "prompt": "Use the Code Auditor skill and produce professional, validated output."
      },
      {
        "name": "code-auditor-doctor",
        "title": "Code Auditor Doctor",
        "description": "Run the Code Auditor Skill quality and readiness checklist.",
        "prompt": "Use Code Auditor to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "code-auditor",
        "title": "/code-auditor",
        "description": "Invoke Code Auditor.",
        "prompt": "Invoke the Code Auditor skill."
      },
      {
        "name": "code-auditor-doctor",
        "title": "/code-auditor-doctor",
        "description": "Diagnose readiness with Code Auditor.",
        "prompt": "Run Code Auditor diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "code_auditor:workflow",
        "title": "Code Auditor Professional Workflow",
        "description": "Default workflow for Code Auditor.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "code_auditor:professional-delivery",
        "title": "Code Auditor Professional Delivery",
        "description": "End-to-end professional workflow for Code Auditor.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Confirm authorization, scope, assets, timelines, and safety constraints.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Collect and normalize evidence without destroying provenance.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Triage severity, blast radius, affected systems, and likely root cause.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend containment, eradication, recovery, detection, and prevention.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Produce an executive summary plus technical appendix and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "code_auditor:quality-gate",
        "title": "Code Auditor Quality Gate",
        "description": "Pre-final validation gate for Code Auditor.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "code_auditor:prefs",
        "category": "workflow",
        "contentTemplate": "For Code Auditor, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "code_auditor:standards",
        "category": "workflow",
        "contentTemplate": "When using Code Auditor, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "code_auditor:handoff",
        "category": "workflow",
        "contentTemplate": "When Code Auditor finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install code_auditor"
  },
  {
    "id": "competitive_intelligence",
    "name": "Competitive Intelligence",
    "version": "1.0.0",
    "description": "Competitive Intelligence delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.",
    "longDescription": "Competitive Intelligence delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "research"
    ],
    "tags": [
      "competitors",
      "positioning",
      "pricing",
      "strategy"
    ],
    "keywords": [
      "competitors",
      "positioning",
      "pricing",
      "strategy",
      "competitive intelligence",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "net",
        "reason": "Competitive Intelligence may need web access for source discovery through XR egress controls.",
        "dangerous": true
      },
      {
        "scope": "fs:write",
        "reason": "Competitive Intelligence may save reports after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "competitive-intelligence",
        "title": "Competitive Intelligence",
        "description": "Apply the Competitive Intelligence skill to a task.",
        "prompt": "Use the Competitive Intelligence skill and produce professional, validated output."
      },
      {
        "name": "competitive-intelligence-doctor",
        "title": "Competitive Intelligence Doctor",
        "description": "Run the Competitive Intelligence Skill quality and readiness checklist.",
        "prompt": "Use Competitive Intelligence to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "competitive-intelligence",
        "title": "/competitive-intelligence",
        "description": "Invoke Competitive Intelligence.",
        "prompt": "Invoke the Competitive Intelligence skill."
      },
      {
        "name": "competitive-intelligence-doctor",
        "title": "/competitive-intelligence-doctor",
        "description": "Diagnose readiness with Competitive Intelligence.",
        "prompt": "Run Competitive Intelligence diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "competitive_intelligence:workflow",
        "title": "Competitive Intelligence Professional Workflow",
        "description": "Default workflow for Competitive Intelligence.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "competitive_intelligence:professional-delivery",
        "title": "Competitive Intelligence Professional Delivery",
        "description": "End-to-end professional workflow for Competitive Intelligence.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Frame the research question, audience, scope, and decision to support.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Plan source strategy across primary, secondary, and contradictory evidence.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Extract claims, methods, dates, metrics, and limitations.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Synthesize findings with confidence and alternative interpretations.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver conclusions, open questions, and recommended next research steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "competitive_intelligence:quality-gate",
        "title": "Competitive Intelligence Quality Gate",
        "description": "Pre-final validation gate for Competitive Intelligence.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "competitive_intelligence:prefs",
        "category": "workflow",
        "contentTemplate": "For Competitive Intelligence, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "competitive_intelligence:standards",
        "category": "workflow",
        "contentTemplate": "When using Competitive Intelligence, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "competitive_intelligence:handoff",
        "category": "workflow",
        "contentTemplate": "When Competitive Intelligence finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install competitive_intelligence"
  },
  {
    "id": "content_creator",
    "name": "Content Creator",
    "version": "1.0.0",
    "description": "Content Creator delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.",
    "longDescription": "Content Creator delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "creative"
    ],
    "tags": [
      "content",
      "calendar",
      "audience",
      "distribution"
    ],
    "keywords": [
      "content",
      "calendar",
      "audience",
      "distribution",
      "content creator",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Content Creator may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "content-creator",
        "title": "Content Creator",
        "description": "Apply the Content Creator skill to a task.",
        "prompt": "Use the Content Creator skill and produce professional, validated output."
      },
      {
        "name": "content-creator-doctor",
        "title": "Content Creator Doctor",
        "description": "Run the Content Creator Skill quality and readiness checklist.",
        "prompt": "Use Content Creator to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "content-creator",
        "title": "/content-creator",
        "description": "Invoke Content Creator.",
        "prompt": "Invoke the Content Creator skill."
      },
      {
        "name": "content-creator-doctor",
        "title": "/content-creator-doctor",
        "description": "Diagnose readiness with Content Creator.",
        "prompt": "Run Content Creator diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "content_creator:workflow",
        "title": "Content Creator Professional Workflow",
        "description": "Default workflow for Content Creator.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "content_creator:professional-delivery",
        "title": "Content Creator Professional Delivery",
        "description": "End-to-end professional workflow for Content Creator.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Define audience, goal, brand/taste direction, constraints, and deliverable format.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Explore creative territories and select a coherent direction.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Produce polished draft artifacts with rationale.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Critique against audience, clarity, originality, and conversion/usability.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver final version plus variants, usage guidance, and next iteration ideas.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "content_creator:quality-gate",
        "title": "Content Creator Quality Gate",
        "description": "Pre-final validation gate for Content Creator.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "content_creator:prefs",
        "category": "workflow",
        "contentTemplate": "For Content Creator, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "content_creator:standards",
        "category": "workflow",
        "contentTemplate": "When using Content Creator, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "content_creator:handoff",
        "category": "workflow",
        "contentTemplate": "When Content Creator finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install content_creator"
  },
  {
    "id": "copywriter",
    "name": "Copywriter",
    "version": "1.0.0",
    "description": "Copywriter delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.",
    "longDescription": "Copywriter delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "creative"
    ],
    "tags": [
      "copy",
      "conversion",
      "voice",
      "messaging"
    ],
    "keywords": [
      "copy",
      "conversion",
      "voice",
      "messaging",
      "copywriter",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Copywriter may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "copywriter",
        "title": "Copywriter",
        "description": "Apply the Copywriter skill to a task.",
        "prompt": "Use the Copywriter skill and produce professional, validated output."
      },
      {
        "name": "copywriter-doctor",
        "title": "Copywriter Doctor",
        "description": "Run the Copywriter Skill quality and readiness checklist.",
        "prompt": "Use Copywriter to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "copywriter",
        "title": "/copywriter",
        "description": "Invoke Copywriter.",
        "prompt": "Invoke the Copywriter skill."
      },
      {
        "name": "copywriter-doctor",
        "title": "/copywriter-doctor",
        "description": "Diagnose readiness with Copywriter.",
        "prompt": "Run Copywriter diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "copywriter:workflow",
        "title": "Copywriter Professional Workflow",
        "description": "Default workflow for Copywriter.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "copywriter:professional-delivery",
        "title": "Copywriter Professional Delivery",
        "description": "End-to-end professional workflow for Copywriter.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Define audience, goal, brand/taste direction, constraints, and deliverable format.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Explore creative territories and select a coherent direction.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Produce polished draft artifacts with rationale.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Critique against audience, clarity, originality, and conversion/usability.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver final version plus variants, usage guidance, and next iteration ideas.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "copywriter:quality-gate",
        "title": "Copywriter Quality Gate",
        "description": "Pre-final validation gate for Copywriter.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "copywriter:prefs",
        "category": "workflow",
        "contentTemplate": "For Copywriter, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "copywriter:standards",
        "category": "workflow",
        "contentTemplate": "When using Copywriter, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "copywriter:handoff",
        "category": "workflow",
        "contentTemplate": "When Copywriter finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install copywriter"
  },
  {
    "id": "customer_support",
    "name": "Customer Support",
    "version": "1.0.0",
    "description": "Customer Support delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "Customer Support delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "support",
      "ticket",
      "customer",
      "service"
    ],
    "keywords": [
      "support",
      "ticket",
      "customer",
      "service",
      "customer support",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Customer Support may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "customer-support",
        "title": "Customer Support",
        "description": "Apply the Customer Support skill to a task.",
        "prompt": "Use the Customer Support skill and produce professional, validated output."
      },
      {
        "name": "customer-support-doctor",
        "title": "Customer Support Doctor",
        "description": "Run the Customer Support Skill quality and readiness checklist.",
        "prompt": "Use Customer Support to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "customer-support",
        "title": "/customer-support",
        "description": "Invoke Customer Support.",
        "prompt": "Invoke the Customer Support skill."
      },
      {
        "name": "customer-support-doctor",
        "title": "/customer-support-doctor",
        "description": "Diagnose readiness with Customer Support.",
        "prompt": "Run Customer Support diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "customer_support:workflow",
        "title": "Customer Support Professional Workflow",
        "description": "Default workflow for Customer Support.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "customer_support:professional-delivery",
        "title": "Customer Support Professional Delivery",
        "description": "End-to-end professional workflow for Customer Support.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "customer_support:quality-gate",
        "title": "Customer Support Quality Gate",
        "description": "Pre-final validation gate for Customer Support.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "customer_support:prefs",
        "category": "workflow",
        "contentTemplate": "For Customer Support, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "customer_support:standards",
        "category": "workflow",
        "contentTemplate": "When using Customer Support, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "customer_support:handoff",
        "category": "workflow",
        "contentTemplate": "When Customer Support finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install customer_support"
  },
  {
    "id": "debugging_expert",
    "name": "Debugging Expert",
    "version": "1.0.0",
    "description": "Debugging Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Debugging Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "debugging",
      "root-cause",
      "observability",
      "triage"
    ],
    "keywords": [
      "debugging",
      "root-cause",
      "observability",
      "triage",
      "debugging expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Debugging Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Debugging Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Debugging Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "debugging-expert",
        "title": "Debugging Expert",
        "description": "Apply the Debugging Expert skill to a task.",
        "prompt": "Use the Debugging Expert skill and produce professional, validated output."
      },
      {
        "name": "debugging-expert-doctor",
        "title": "Debugging Expert Doctor",
        "description": "Run the Debugging Expert Skill quality and readiness checklist.",
        "prompt": "Use Debugging Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "debugging-expert",
        "title": "/debugging-expert",
        "description": "Invoke Debugging Expert.",
        "prompt": "Invoke the Debugging Expert skill."
      },
      {
        "name": "debugging-expert-doctor",
        "title": "/debugging-expert-doctor",
        "description": "Diagnose readiness with Debugging Expert.",
        "prompt": "Run Debugging Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "debugging_expert:workflow",
        "title": "Debugging Expert Professional Workflow",
        "description": "Default workflow for Debugging Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "debugging_expert:professional-delivery",
        "title": "Debugging Expert Professional Delivery",
        "description": "End-to-end professional workflow for Debugging Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "debugging_expert:quality-gate",
        "title": "Debugging Expert Quality Gate",
        "description": "Pre-final validation gate for Debugging Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "debugging_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Debugging Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "debugging_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Debugging Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "debugging_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Debugging Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install debugging_expert"
  },
  {
    "id": "deep_research",
    "name": "Deep Research",
    "version": "1.0.0",
    "description": "Deep Research delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.",
    "longDescription": "Deep Research delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "research"
    ],
    "tags": [
      "research",
      "synthesis",
      "sources",
      "analysis"
    ],
    "keywords": [
      "research",
      "synthesis",
      "sources",
      "analysis",
      "deep research",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "net",
        "reason": "Deep Research may need web access for source discovery through XR egress controls.",
        "dangerous": true
      },
      {
        "scope": "fs:write",
        "reason": "Deep Research may save reports after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "deep-research",
        "title": "Deep Research",
        "description": "Apply the Deep Research skill to a task.",
        "prompt": "Use the Deep Research skill and produce professional, validated output."
      },
      {
        "name": "deep-research-doctor",
        "title": "Deep Research Doctor",
        "description": "Run the Deep Research Skill quality and readiness checklist.",
        "prompt": "Use Deep Research to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "deep-research",
        "title": "/deep-research",
        "description": "Invoke Deep Research.",
        "prompt": "Invoke the Deep Research skill."
      },
      {
        "name": "deep-research-doctor",
        "title": "/deep-research-doctor",
        "description": "Diagnose readiness with Deep Research.",
        "prompt": "Run Deep Research diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "deep_research:workflow",
        "title": "Deep Research Professional Workflow",
        "description": "Default workflow for Deep Research.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "deep_research:professional-delivery",
        "title": "Deep Research Professional Delivery",
        "description": "End-to-end professional workflow for Deep Research.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Frame the research question, audience, scope, and decision to support.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Plan source strategy across primary, secondary, and contradictory evidence.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Extract claims, methods, dates, metrics, and limitations.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Synthesize findings with confidence and alternative interpretations.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver conclusions, open questions, and recommended next research steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "deep_research:quality-gate",
        "title": "Deep Research Quality Gate",
        "description": "Pre-final validation gate for Deep Research.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "deep_research:prefs",
        "category": "workflow",
        "contentTemplate": "For Deep Research, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "deep_research:standards",
        "category": "workflow",
        "contentTemplate": "When using Deep Research, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "deep_research:handoff",
        "category": "workflow",
        "contentTemplate": "When Deep Research finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install deep_research"
  },
  {
    "id": "devops_engineer",
    "name": "DevOps Engineer",
    "version": "1.0.0",
    "description": "DevOps Engineer delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "DevOps Engineer delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "ci-cd",
      "infra",
      "observability",
      "devops"
    ],
    "keywords": [
      "ci-cd",
      "infra",
      "observability",
      "devops",
      "devops engineer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "DevOps Engineer may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "DevOps Engineer may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "DevOps Engineer may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "devops-engineer",
        "title": "DevOps Engineer",
        "description": "Apply the DevOps Engineer skill to a task.",
        "prompt": "Use the DevOps Engineer skill and produce professional, validated output."
      },
      {
        "name": "devops-engineer-doctor",
        "title": "DevOps Engineer Doctor",
        "description": "Run the DevOps Engineer Skill quality and readiness checklist.",
        "prompt": "Use DevOps Engineer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "devops-engineer",
        "title": "/devops-engineer",
        "description": "Invoke DevOps Engineer.",
        "prompt": "Invoke the DevOps Engineer skill."
      },
      {
        "name": "devops-engineer-doctor",
        "title": "/devops-engineer-doctor",
        "description": "Diagnose readiness with DevOps Engineer.",
        "prompt": "Run DevOps Engineer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "devops_engineer:workflow",
        "title": "DevOps Engineer Professional Workflow",
        "description": "Default workflow for DevOps Engineer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "devops_engineer:professional-delivery",
        "title": "DevOps Engineer Professional Delivery",
        "description": "End-to-end professional workflow for DevOps Engineer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "devops_engineer:quality-gate",
        "title": "DevOps Engineer Quality Gate",
        "description": "Pre-final validation gate for DevOps Engineer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "devops_engineer:prefs",
        "category": "workflow",
        "contentTemplate": "For DevOps Engineer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "devops_engineer:standards",
        "category": "workflow",
        "contentTemplate": "When using DevOps Engineer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "devops_engineer:handoff",
        "category": "workflow",
        "contentTemplate": "When DevOps Engineer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install devops_engineer"
  },
  {
    "id": "docker_expert",
    "name": "Docker Expert",
    "version": "1.0.0",
    "description": "Docker Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Docker Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "docker",
      "containers",
      "deployment",
      "devops"
    ],
    "keywords": [
      "docker",
      "containers",
      "deployment",
      "devops",
      "docker expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Docker Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Docker Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Docker Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "docker-expert",
        "title": "Docker Expert",
        "description": "Apply the Docker Expert skill to a task.",
        "prompt": "Use the Docker Expert skill and produce professional, validated output."
      },
      {
        "name": "docker-expert-doctor",
        "title": "Docker Expert Doctor",
        "description": "Run the Docker Expert Skill quality and readiness checklist.",
        "prompt": "Use Docker Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "docker-expert",
        "title": "/docker-expert",
        "description": "Invoke Docker Expert.",
        "prompt": "Invoke the Docker Expert skill."
      },
      {
        "name": "docker-expert-doctor",
        "title": "/docker-expert-doctor",
        "description": "Diagnose readiness with Docker Expert.",
        "prompt": "Run Docker Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "docker_expert:workflow",
        "title": "Docker Expert Professional Workflow",
        "description": "Default workflow for Docker Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "docker_expert:professional-delivery",
        "title": "Docker Expert Professional Delivery",
        "description": "End-to-end professional workflow for Docker Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "docker_expert:quality-gate",
        "title": "Docker Expert Quality Gate",
        "description": "Pre-final validation gate for Docker Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "docker_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Docker Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "docker_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Docker Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "docker_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Docker Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install docker_expert"
  },
  {
    "id": "email_writer",
    "name": "Email Writer",
    "version": "1.0.0",
    "description": "Email Writer delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "Email Writer delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "email",
      "communication",
      "copy",
      "outreach"
    ],
    "keywords": [
      "email",
      "communication",
      "copy",
      "outreach",
      "email writer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Email Writer may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "email-writer",
        "title": "Email Writer",
        "description": "Apply the Email Writer skill to a task.",
        "prompt": "Use the Email Writer skill and produce professional, validated output."
      },
      {
        "name": "email-writer-doctor",
        "title": "Email Writer Doctor",
        "description": "Run the Email Writer Skill quality and readiness checklist.",
        "prompt": "Use Email Writer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "email-writer",
        "title": "/email-writer",
        "description": "Invoke Email Writer.",
        "prompt": "Invoke the Email Writer skill."
      },
      {
        "name": "email-writer-doctor",
        "title": "/email-writer-doctor",
        "description": "Diagnose readiness with Email Writer.",
        "prompt": "Run Email Writer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "email_writer:workflow",
        "title": "Email Writer Professional Workflow",
        "description": "Default workflow for Email Writer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "email_writer:professional-delivery",
        "title": "Email Writer Professional Delivery",
        "description": "End-to-end professional workflow for Email Writer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "email_writer:quality-gate",
        "title": "Email Writer Quality Gate",
        "description": "Pre-final validation gate for Email Writer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "email_writer:prefs",
        "category": "workflow",
        "contentTemplate": "For Email Writer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "email_writer:standards",
        "category": "workflow",
        "contentTemplate": "When using Email Writer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "email_writer:handoff",
        "category": "workflow",
        "contentTemplate": "When Email Writer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install email_writer"
  },
  {
    "id": "financial_analyst",
    "name": "Financial Analyst",
    "version": "1.0.0",
    "description": "Financial Analyst delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "Financial Analyst delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "finance",
      "modeling",
      "metrics",
      "analysis"
    ],
    "keywords": [
      "finance",
      "modeling",
      "metrics",
      "analysis",
      "financial analyst",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Financial Analyst may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "financial-analyst",
        "title": "Financial Analyst",
        "description": "Apply the Financial Analyst skill to a task.",
        "prompt": "Use the Financial Analyst skill and produce professional, validated output."
      },
      {
        "name": "financial-analyst-doctor",
        "title": "Financial Analyst Doctor",
        "description": "Run the Financial Analyst Skill quality and readiness checklist.",
        "prompt": "Use Financial Analyst to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "financial-analyst",
        "title": "/financial-analyst",
        "description": "Invoke Financial Analyst.",
        "prompt": "Invoke the Financial Analyst skill."
      },
      {
        "name": "financial-analyst-doctor",
        "title": "/financial-analyst-doctor",
        "description": "Diagnose readiness with Financial Analyst.",
        "prompt": "Run Financial Analyst diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "financial_analyst:workflow",
        "title": "Financial Analyst Professional Workflow",
        "description": "Default workflow for Financial Analyst.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "financial_analyst:professional-delivery",
        "title": "Financial Analyst Professional Delivery",
        "description": "End-to-end professional workflow for Financial Analyst.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "financial_analyst:quality-gate",
        "title": "Financial Analyst Quality Gate",
        "description": "Pre-final validation gate for Financial Analyst.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "financial_analyst:prefs",
        "category": "workflow",
        "contentTemplate": "For Financial Analyst, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "financial_analyst:standards",
        "category": "workflow",
        "contentTemplate": "When using Financial Analyst, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "financial_analyst:handoff",
        "category": "workflow",
        "contentTemplate": "When Financial Analyst finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install financial_analyst"
  },
  {
    "id": "full_stack_engineer",
    "name": "Full Stack Engineer",
    "version": "1.0.0",
    "description": "Full Stack Engineer delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Full Stack Engineer delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "architecture",
      "frontend",
      "backend",
      "delivery"
    ],
    "keywords": [
      "architecture",
      "frontend",
      "backend",
      "delivery",
      "full stack engineer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Full Stack Engineer may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Full Stack Engineer may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Full Stack Engineer may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "full-stack-engineer",
        "title": "Full Stack Engineer",
        "description": "Apply the Full Stack Engineer skill to a task.",
        "prompt": "Use the Full Stack Engineer skill and produce professional, validated output."
      },
      {
        "name": "full-stack-engineer-doctor",
        "title": "Full Stack Engineer Doctor",
        "description": "Run the Full Stack Engineer Skill quality and readiness checklist.",
        "prompt": "Use Full Stack Engineer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "full-stack-engineer",
        "title": "/full-stack-engineer",
        "description": "Invoke Full Stack Engineer.",
        "prompt": "Invoke the Full Stack Engineer skill."
      },
      {
        "name": "full-stack-engineer-doctor",
        "title": "/full-stack-engineer-doctor",
        "description": "Diagnose readiness with Full Stack Engineer.",
        "prompt": "Run Full Stack Engineer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "full_stack_engineer:workflow",
        "title": "Full Stack Engineer Professional Workflow",
        "description": "Default workflow for Full Stack Engineer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "full_stack_engineer:professional-delivery",
        "title": "Full Stack Engineer Professional Delivery",
        "description": "End-to-end professional workflow for Full Stack Engineer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "full_stack_engineer:quality-gate",
        "title": "Full Stack Engineer Quality Gate",
        "description": "Pre-final validation gate for Full Stack Engineer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "full_stack_engineer:prefs",
        "category": "workflow",
        "contentTemplate": "For Full Stack Engineer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "full_stack_engineer:standards",
        "category": "workflow",
        "contentTemplate": "When using Full Stack Engineer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "full_stack_engineer:handoff",
        "category": "workflow",
        "contentTemplate": "When Full Stack Engineer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install full_stack_engineer"
  },
  {
    "id": "git_expert",
    "name": "Git Expert",
    "version": "1.0.0",
    "description": "Git Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Git Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "git",
      "branching",
      "history",
      "review"
    ],
    "keywords": [
      "git",
      "branching",
      "history",
      "review",
      "git expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Git Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Git Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Git Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "git-expert",
        "title": "Git Expert",
        "description": "Apply the Git Expert skill to a task.",
        "prompt": "Use the Git Expert skill and produce professional, validated output."
      },
      {
        "name": "git-expert-doctor",
        "title": "Git Expert Doctor",
        "description": "Run the Git Expert Skill quality and readiness checklist.",
        "prompt": "Use Git Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "git-expert",
        "title": "/git-expert",
        "description": "Invoke Git Expert.",
        "prompt": "Invoke the Git Expert skill."
      },
      {
        "name": "git-expert-doctor",
        "title": "/git-expert-doctor",
        "description": "Diagnose readiness with Git Expert.",
        "prompt": "Run Git Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "git_expert:workflow",
        "title": "Git Expert Professional Workflow",
        "description": "Default workflow for Git Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "git_expert:professional-delivery",
        "title": "Git Expert Professional Delivery",
        "description": "End-to-end professional workflow for Git Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "git_expert:quality-gate",
        "title": "Git Expert Quality Gate",
        "description": "Pre-final validation gate for Git Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "git_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Git Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "git_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Git Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "git_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Git Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install git_expert"
  },
  {
    "id": "go_expert",
    "name": "Go Expert",
    "version": "1.0.0",
    "description": "Go Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Go Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "go",
      "services",
      "concurrency",
      "backend"
    ],
    "keywords": [
      "go",
      "services",
      "concurrency",
      "backend",
      "go expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Go Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Go Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Go Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "go-expert",
        "title": "Go Expert",
        "description": "Apply the Go Expert skill to a task.",
        "prompt": "Use the Go Expert skill and produce professional, validated output."
      },
      {
        "name": "go-expert-doctor",
        "title": "Go Expert Doctor",
        "description": "Run the Go Expert Skill quality and readiness checklist.",
        "prompt": "Use Go Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "go-expert",
        "title": "/go-expert",
        "description": "Invoke Go Expert.",
        "prompt": "Invoke the Go Expert skill."
      },
      {
        "name": "go-expert-doctor",
        "title": "/go-expert-doctor",
        "description": "Diagnose readiness with Go Expert.",
        "prompt": "Run Go Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "go_expert:workflow",
        "title": "Go Expert Professional Workflow",
        "description": "Default workflow for Go Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "go_expert:professional-delivery",
        "title": "Go Expert Professional Delivery",
        "description": "End-to-end professional workflow for Go Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "go_expert:quality-gate",
        "title": "Go Expert Quality Gate",
        "description": "Pre-final validation gate for Go Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "go_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Go Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "go_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Go Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "go_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Go Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install go_expert"
  },
  {
    "id": "incident_response",
    "name": "Incident Response",
    "version": "1.0.0",
    "description": "Incident Response delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.",
    "longDescription": "Incident Response delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "security"
    ],
    "tags": [
      "incident",
      "forensics",
      "containment",
      "eradication"
    ],
    "keywords": [
      "incident",
      "forensics",
      "containment",
      "eradication",
      "incident response",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Incident Response may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "incident-response",
        "title": "Incident Response",
        "description": "Apply the Incident Response skill to a task.",
        "prompt": "Use the Incident Response skill and produce professional, validated output."
      },
      {
        "name": "incident-response-doctor",
        "title": "Incident Response Doctor",
        "description": "Run the Incident Response Skill quality and readiness checklist.",
        "prompt": "Use Incident Response to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "incident-response",
        "title": "/incident-response",
        "description": "Invoke Incident Response.",
        "prompt": "Invoke the Incident Response skill."
      },
      {
        "name": "incident-response-doctor",
        "title": "/incident-response-doctor",
        "description": "Diagnose readiness with Incident Response.",
        "prompt": "Run Incident Response diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "incident_response:workflow",
        "title": "Incident Response Professional Workflow",
        "description": "Default workflow for Incident Response.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "incident_response:professional-delivery",
        "title": "Incident Response Professional Delivery",
        "description": "End-to-end professional workflow for Incident Response.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Confirm authorization, scope, assets, timelines, and safety constraints.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Collect and normalize evidence without destroying provenance.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Triage severity, blast radius, affected systems, and likely root cause.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend containment, eradication, recovery, detection, and prevention.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Produce an executive summary plus technical appendix and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "incident_response:quality-gate",
        "title": "Incident Response Quality Gate",
        "description": "Pre-final validation gate for Incident Response.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "incident_response:prefs",
        "category": "workflow",
        "contentTemplate": "For Incident Response, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "incident_response:standards",
        "category": "workflow",
        "contentTemplate": "When using Incident Response, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "incident_response:handoff",
        "category": "workflow",
        "contentTemplate": "When Incident Response finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install incident_response"
  },
  {
    "id": "java_expert",
    "name": "Java Expert",
    "version": "1.0.0",
    "description": "Java Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Java Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "java",
      "spring",
      "enterprise",
      "backend"
    ],
    "keywords": [
      "java",
      "spring",
      "enterprise",
      "backend",
      "java expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Java Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Java Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Java Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "java-expert",
        "title": "Java Expert",
        "description": "Apply the Java Expert skill to a task.",
        "prompt": "Use the Java Expert skill and produce professional, validated output."
      },
      {
        "name": "java-expert-doctor",
        "title": "Java Expert Doctor",
        "description": "Run the Java Expert Skill quality and readiness checklist.",
        "prompt": "Use Java Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "java-expert",
        "title": "/java-expert",
        "description": "Invoke Java Expert.",
        "prompt": "Invoke the Java Expert skill."
      },
      {
        "name": "java-expert-doctor",
        "title": "/java-expert-doctor",
        "description": "Diagnose readiness with Java Expert.",
        "prompt": "Run Java Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "java_expert:workflow",
        "title": "Java Expert Professional Workflow",
        "description": "Default workflow for Java Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "java_expert:professional-delivery",
        "title": "Java Expert Professional Delivery",
        "description": "End-to-end professional workflow for Java Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "java_expert:quality-gate",
        "title": "Java Expert Quality Gate",
        "description": "Pre-final validation gate for Java Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "java_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Java Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "java_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Java Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "java_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Java Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install java_expert"
  },
  {
    "id": "kubernetes_expert",
    "name": "Kubernetes Expert",
    "version": "1.0.0",
    "description": "Kubernetes Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Kubernetes Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "kubernetes",
      "cluster",
      "helm",
      "devops"
    ],
    "keywords": [
      "kubernetes",
      "cluster",
      "helm",
      "devops",
      "kubernetes expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Kubernetes Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Kubernetes Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Kubernetes Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "kubernetes-expert",
        "title": "Kubernetes Expert",
        "description": "Apply the Kubernetes Expert skill to a task.",
        "prompt": "Use the Kubernetes Expert skill and produce professional, validated output."
      },
      {
        "name": "kubernetes-expert-doctor",
        "title": "Kubernetes Expert Doctor",
        "description": "Run the Kubernetes Expert Skill quality and readiness checklist.",
        "prompt": "Use Kubernetes Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "kubernetes-expert",
        "title": "/kubernetes-expert",
        "description": "Invoke Kubernetes Expert.",
        "prompt": "Invoke the Kubernetes Expert skill."
      },
      {
        "name": "kubernetes-expert-doctor",
        "title": "/kubernetes-expert-doctor",
        "description": "Diagnose readiness with Kubernetes Expert.",
        "prompt": "Run Kubernetes Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "kubernetes_expert:workflow",
        "title": "Kubernetes Expert Professional Workflow",
        "description": "Default workflow for Kubernetes Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "kubernetes_expert:professional-delivery",
        "title": "Kubernetes Expert Professional Delivery",
        "description": "End-to-end professional workflow for Kubernetes Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "kubernetes_expert:quality-gate",
        "title": "Kubernetes Expert Quality Gate",
        "description": "Pre-final validation gate for Kubernetes Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "kubernetes_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Kubernetes Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "kubernetes_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Kubernetes Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "kubernetes_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Kubernetes Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install kubernetes_expert"
  },
  {
    "id": "logo_designer",
    "name": "Logo Designer",
    "version": "1.0.0",
    "description": "Logo Designer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.",
    "longDescription": "Logo Designer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "creative"
    ],
    "tags": [
      "logo",
      "identity",
      "brand",
      "visual"
    ],
    "keywords": [
      "logo",
      "identity",
      "brand",
      "visual",
      "logo designer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Logo Designer may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "logo-designer",
        "title": "Logo Designer",
        "description": "Apply the Logo Designer skill to a task.",
        "prompt": "Use the Logo Designer skill and produce professional, validated output."
      },
      {
        "name": "logo-designer-doctor",
        "title": "Logo Designer Doctor",
        "description": "Run the Logo Designer Skill quality and readiness checklist.",
        "prompt": "Use Logo Designer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "logo-designer",
        "title": "/logo-designer",
        "description": "Invoke Logo Designer.",
        "prompt": "Invoke the Logo Designer skill."
      },
      {
        "name": "logo-designer-doctor",
        "title": "/logo-designer-doctor",
        "description": "Diagnose readiness with Logo Designer.",
        "prompt": "Run Logo Designer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "logo_designer:workflow",
        "title": "Logo Designer Professional Workflow",
        "description": "Default workflow for Logo Designer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "logo_designer:professional-delivery",
        "title": "Logo Designer Professional Delivery",
        "description": "End-to-end professional workflow for Logo Designer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Define audience, goal, brand/taste direction, constraints, and deliverable format.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Explore creative territories and select a coherent direction.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Produce polished draft artifacts with rationale.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Critique against audience, clarity, originality, and conversion/usability.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver final version plus variants, usage guidance, and next iteration ideas.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "logo_designer:quality-gate",
        "title": "Logo Designer Quality Gate",
        "description": "Pre-final validation gate for Logo Designer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "logo_designer:prefs",
        "category": "workflow",
        "contentTemplate": "For Logo Designer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "logo_designer:standards",
        "category": "workflow",
        "contentTemplate": "When using Logo Designer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "logo_designer:handoff",
        "category": "workflow",
        "contentTemplate": "When Logo Designer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install logo_designer"
  },
  {
    "id": "malware_analyst",
    "name": "Malware Analyst",
    "version": "1.0.0",
    "description": "Malware Analyst delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.",
    "longDescription": "Malware Analyst delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "security"
    ],
    "tags": [
      "malware",
      "reverse-engineering",
      "ioc",
      "analysis"
    ],
    "keywords": [
      "malware",
      "reverse-engineering",
      "ioc",
      "analysis",
      "malware analyst",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Malware Analyst may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "malware-analyst",
        "title": "Malware Analyst",
        "description": "Apply the Malware Analyst skill to a task.",
        "prompt": "Use the Malware Analyst skill and produce professional, validated output."
      },
      {
        "name": "malware-analyst-doctor",
        "title": "Malware Analyst Doctor",
        "description": "Run the Malware Analyst Skill quality and readiness checklist.",
        "prompt": "Use Malware Analyst to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "malware-analyst",
        "title": "/malware-analyst",
        "description": "Invoke Malware Analyst.",
        "prompt": "Invoke the Malware Analyst skill."
      },
      {
        "name": "malware-analyst-doctor",
        "title": "/malware-analyst-doctor",
        "description": "Diagnose readiness with Malware Analyst.",
        "prompt": "Run Malware Analyst diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "malware_analyst:workflow",
        "title": "Malware Analyst Professional Workflow",
        "description": "Default workflow for Malware Analyst.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "malware_analyst:professional-delivery",
        "title": "Malware Analyst Professional Delivery",
        "description": "End-to-end professional workflow for Malware Analyst.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Confirm authorization, scope, assets, timelines, and safety constraints.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Collect and normalize evidence without destroying provenance.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Triage severity, blast radius, affected systems, and likely root cause.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend containment, eradication, recovery, detection, and prevention.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Produce an executive summary plus technical appendix and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "malware_analyst:quality-gate",
        "title": "Malware Analyst Quality Gate",
        "description": "Pre-final validation gate for Malware Analyst.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "malware_analyst:prefs",
        "category": "workflow",
        "contentTemplate": "For Malware Analyst, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "malware_analyst:standards",
        "category": "workflow",
        "contentTemplate": "When using Malware Analyst, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "malware_analyst:handoff",
        "category": "workflow",
        "contentTemplate": "When Malware Analyst finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install malware_analyst"
  },
  {
    "id": "market_research",
    "name": "Market Research",
    "version": "1.0.0",
    "description": "Market Research delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.",
    "longDescription": "Market Research delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "research"
    ],
    "tags": [
      "market",
      "customers",
      "segments",
      "tam"
    ],
    "keywords": [
      "market",
      "customers",
      "segments",
      "tam",
      "market research",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "net",
        "reason": "Market Research may need web access for source discovery through XR egress controls.",
        "dangerous": true
      },
      {
        "scope": "fs:write",
        "reason": "Market Research may save reports after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "market-research",
        "title": "Market Research",
        "description": "Apply the Market Research skill to a task.",
        "prompt": "Use the Market Research skill and produce professional, validated output."
      },
      {
        "name": "market-research-doctor",
        "title": "Market Research Doctor",
        "description": "Run the Market Research Skill quality and readiness checklist.",
        "prompt": "Use Market Research to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "market-research",
        "title": "/market-research",
        "description": "Invoke Market Research.",
        "prompt": "Invoke the Market Research skill."
      },
      {
        "name": "market-research-doctor",
        "title": "/market-research-doctor",
        "description": "Diagnose readiness with Market Research.",
        "prompt": "Run Market Research diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "market_research:workflow",
        "title": "Market Research Professional Workflow",
        "description": "Default workflow for Market Research.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "market_research:professional-delivery",
        "title": "Market Research Professional Delivery",
        "description": "End-to-end professional workflow for Market Research.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Frame the research question, audience, scope, and decision to support.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Plan source strategy across primary, secondary, and contradictory evidence.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Extract claims, methods, dates, metrics, and limitations.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Synthesize findings with confidence and alternative interpretations.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver conclusions, open questions, and recommended next research steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "market_research:quality-gate",
        "title": "Market Research Quality Gate",
        "description": "Pre-final validation gate for Market Research.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "market_research:prefs",
        "category": "workflow",
        "contentTemplate": "For Market Research, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "market_research:standards",
        "category": "workflow",
        "contentTemplate": "When using Market Research, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "market_research:handoff",
        "category": "workflow",
        "contentTemplate": "When Market Research finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install market_research"
  },
  {
    "id": "marketing_strategist",
    "name": "Marketing Strategist",
    "version": "1.0.0",
    "description": "Marketing Strategist delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "Marketing Strategist delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "marketing",
      "positioning",
      "campaigns",
      "growth"
    ],
    "keywords": [
      "marketing",
      "positioning",
      "campaigns",
      "growth",
      "marketing strategist",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Marketing Strategist may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "marketing-strategist",
        "title": "Marketing Strategist",
        "description": "Apply the Marketing Strategist skill to a task.",
        "prompt": "Use the Marketing Strategist skill and produce professional, validated output."
      },
      {
        "name": "marketing-strategist-doctor",
        "title": "Marketing Strategist Doctor",
        "description": "Run the Marketing Strategist Skill quality and readiness checklist.",
        "prompt": "Use Marketing Strategist to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "marketing-strategist",
        "title": "/marketing-strategist",
        "description": "Invoke Marketing Strategist.",
        "prompt": "Invoke the Marketing Strategist skill."
      },
      {
        "name": "marketing-strategist-doctor",
        "title": "/marketing-strategist-doctor",
        "description": "Diagnose readiness with Marketing Strategist.",
        "prompt": "Run Marketing Strategist diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "marketing_strategist:workflow",
        "title": "Marketing Strategist Professional Workflow",
        "description": "Default workflow for Marketing Strategist.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "marketing_strategist:professional-delivery",
        "title": "Marketing Strategist Professional Delivery",
        "description": "End-to-end professional workflow for Marketing Strategist.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "marketing_strategist:quality-gate",
        "title": "Marketing Strategist Quality Gate",
        "description": "Pre-final validation gate for Marketing Strategist.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "marketing_strategist:prefs",
        "category": "workflow",
        "contentTemplate": "For Marketing Strategist, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "marketing_strategist:standards",
        "category": "workflow",
        "contentTemplate": "When using Marketing Strategist, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "marketing_strategist:handoff",
        "category": "workflow",
        "contentTemplate": "When Marketing Strategist finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install marketing_strategist"
  },
  {
    "id": "negotiation_expert",
    "name": "Negotiation Expert",
    "version": "1.0.0",
    "description": "Negotiation Expert delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "Negotiation Expert delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "negotiation",
      "deals",
      "pricing",
      "communication"
    ],
    "keywords": [
      "negotiation",
      "deals",
      "pricing",
      "communication",
      "negotiation expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Negotiation Expert may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "negotiation-expert",
        "title": "Negotiation Expert",
        "description": "Apply the Negotiation Expert skill to a task.",
        "prompt": "Use the Negotiation Expert skill and produce professional, validated output."
      },
      {
        "name": "negotiation-expert-doctor",
        "title": "Negotiation Expert Doctor",
        "description": "Run the Negotiation Expert Skill quality and readiness checklist.",
        "prompt": "Use Negotiation Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "negotiation-expert",
        "title": "/negotiation-expert",
        "description": "Invoke Negotiation Expert.",
        "prompt": "Invoke the Negotiation Expert skill."
      },
      {
        "name": "negotiation-expert-doctor",
        "title": "/negotiation-expert-doctor",
        "description": "Diagnose readiness with Negotiation Expert.",
        "prompt": "Run Negotiation Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "negotiation_expert:workflow",
        "title": "Negotiation Expert Professional Workflow",
        "description": "Default workflow for Negotiation Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "negotiation_expert:professional-delivery",
        "title": "Negotiation Expert Professional Delivery",
        "description": "End-to-end professional workflow for Negotiation Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "negotiation_expert:quality-gate",
        "title": "Negotiation Expert Quality Gate",
        "description": "Pre-final validation gate for Negotiation Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "negotiation_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Negotiation Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "negotiation_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Negotiation Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "negotiation_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Negotiation Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install negotiation_expert"
  },
  {
    "id": "nextjs_expert",
    "name": "Next.js Expert",
    "version": "1.0.0",
    "description": "Next.js Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Next.js Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "nextjs",
      "app-router",
      "vercel",
      "frontend"
    ],
    "keywords": [
      "nextjs",
      "app-router",
      "vercel",
      "frontend",
      "next.js expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Next.js Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Next.js Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Next.js Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "nextjs-expert",
        "title": "Next.js Expert",
        "description": "Apply the Next.js Expert skill to a task.",
        "prompt": "Use the Next.js Expert skill and produce professional, validated output."
      },
      {
        "name": "nextjs-expert-doctor",
        "title": "Next.js Expert Doctor",
        "description": "Run the Next.js Expert Skill quality and readiness checklist.",
        "prompt": "Use Next.js Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "nextjs-expert",
        "title": "/nextjs-expert",
        "description": "Invoke Next.js Expert.",
        "prompt": "Invoke the Next.js Expert skill."
      },
      {
        "name": "nextjs-expert-doctor",
        "title": "/nextjs-expert-doctor",
        "description": "Diagnose readiness with Next.js Expert.",
        "prompt": "Run Next.js Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "nextjs_expert:workflow",
        "title": "Next.js Expert Professional Workflow",
        "description": "Default workflow for Next.js Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "nextjs_expert:professional-delivery",
        "title": "Next.js Expert Professional Delivery",
        "description": "End-to-end professional workflow for Next.js Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "nextjs_expert:quality-gate",
        "title": "Next.js Expert Quality Gate",
        "description": "Pre-final validation gate for Next.js Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "nextjs_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Next.js Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "nextjs_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Next.js Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "nextjs_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Next.js Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install nextjs_expert"
  },
  {
    "id": "node_expert",
    "name": "Node Expert",
    "version": "1.0.0",
    "description": "Node Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Node Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "node",
      "api",
      "typescript",
      "backend"
    ],
    "keywords": [
      "node",
      "api",
      "typescript",
      "backend",
      "node expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Node Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Node Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Node Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "node-expert",
        "title": "Node Expert",
        "description": "Apply the Node Expert skill to a task.",
        "prompt": "Use the Node Expert skill and produce professional, validated output."
      },
      {
        "name": "node-expert-doctor",
        "title": "Node Expert Doctor",
        "description": "Run the Node Expert Skill quality and readiness checklist.",
        "prompt": "Use Node Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "node-expert",
        "title": "/node-expert",
        "description": "Invoke Node Expert.",
        "prompt": "Invoke the Node Expert skill."
      },
      {
        "name": "node-expert-doctor",
        "title": "/node-expert-doctor",
        "description": "Diagnose readiness with Node Expert.",
        "prompt": "Run Node Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "node_expert:workflow",
        "title": "Node Expert Professional Workflow",
        "description": "Default workflow for Node Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "node_expert:professional-delivery",
        "title": "Node Expert Professional Delivery",
        "description": "End-to-end professional workflow for Node Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "node_expert:quality-gate",
        "title": "Node Expert Quality Gate",
        "description": "Pre-final validation gate for Node Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "node_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Node Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "node_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Node Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "node_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Node Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install node_expert"
  },
  {
    "id": "osint_researcher",
    "name": "OSINT Researcher",
    "version": "1.0.0",
    "description": "OSINT Researcher delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.",
    "longDescription": "OSINT Researcher delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "security"
    ],
    "tags": [
      "osint",
      "investigation",
      "sources",
      "attribution"
    ],
    "keywords": [
      "osint",
      "investigation",
      "sources",
      "attribution",
      "osint researcher",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "OSINT Researcher may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "osint-researcher",
        "title": "OSINT Researcher",
        "description": "Apply the OSINT Researcher skill to a task.",
        "prompt": "Use the OSINT Researcher skill and produce professional, validated output."
      },
      {
        "name": "osint-researcher-doctor",
        "title": "OSINT Researcher Doctor",
        "description": "Run the OSINT Researcher Skill quality and readiness checklist.",
        "prompt": "Use OSINT Researcher to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "osint-researcher",
        "title": "/osint-researcher",
        "description": "Invoke OSINT Researcher.",
        "prompt": "Invoke the OSINT Researcher skill."
      },
      {
        "name": "osint-researcher-doctor",
        "title": "/osint-researcher-doctor",
        "description": "Diagnose readiness with OSINT Researcher.",
        "prompt": "Run OSINT Researcher diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "osint_researcher:workflow",
        "title": "OSINT Researcher Professional Workflow",
        "description": "Default workflow for OSINT Researcher.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "osint_researcher:professional-delivery",
        "title": "OSINT Researcher Professional Delivery",
        "description": "End-to-end professional workflow for OSINT Researcher.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Confirm authorization, scope, assets, timelines, and safety constraints.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Collect and normalize evidence without destroying provenance.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Triage severity, blast radius, affected systems, and likely root cause.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend containment, eradication, recovery, detection, and prevention.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Produce an executive summary plus technical appendix and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "osint_researcher:quality-gate",
        "title": "OSINT Researcher Quality Gate",
        "description": "Pre-final validation gate for OSINT Researcher.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "osint_researcher:prefs",
        "category": "workflow",
        "contentTemplate": "For OSINT Researcher, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "osint_researcher:standards",
        "category": "workflow",
        "contentTemplate": "When using OSINT Researcher, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "osint_researcher:handoff",
        "category": "workflow",
        "contentTemplate": "When OSINT Researcher finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install osint_researcher"
  },
  {
    "id": "paper_analyzer",
    "name": "Paper Analyzer",
    "version": "1.0.0",
    "description": "Paper Analyzer delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.",
    "longDescription": "Paper Analyzer delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "research"
    ],
    "tags": [
      "papers",
      "methods",
      "results",
      "critique"
    ],
    "keywords": [
      "papers",
      "methods",
      "results",
      "critique",
      "paper analyzer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "net",
        "reason": "Paper Analyzer may need web access for source discovery through XR egress controls.",
        "dangerous": true
      },
      {
        "scope": "fs:write",
        "reason": "Paper Analyzer may save reports after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "paper-analyzer",
        "title": "Paper Analyzer",
        "description": "Apply the Paper Analyzer skill to a task.",
        "prompt": "Use the Paper Analyzer skill and produce professional, validated output."
      },
      {
        "name": "paper-analyzer-doctor",
        "title": "Paper Analyzer Doctor",
        "description": "Run the Paper Analyzer Skill quality and readiness checklist.",
        "prompt": "Use Paper Analyzer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "paper-analyzer",
        "title": "/paper-analyzer",
        "description": "Invoke Paper Analyzer.",
        "prompt": "Invoke the Paper Analyzer skill."
      },
      {
        "name": "paper-analyzer-doctor",
        "title": "/paper-analyzer-doctor",
        "description": "Diagnose readiness with Paper Analyzer.",
        "prompt": "Run Paper Analyzer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "paper_analyzer:workflow",
        "title": "Paper Analyzer Professional Workflow",
        "description": "Default workflow for Paper Analyzer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "paper_analyzer:professional-delivery",
        "title": "Paper Analyzer Professional Delivery",
        "description": "End-to-end professional workflow for Paper Analyzer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Frame the research question, audience, scope, and decision to support.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Plan source strategy across primary, secondary, and contradictory evidence.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Extract claims, methods, dates, metrics, and limitations.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Synthesize findings with confidence and alternative interpretations.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver conclusions, open questions, and recommended next research steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "paper_analyzer:quality-gate",
        "title": "Paper Analyzer Quality Gate",
        "description": "Pre-final validation gate for Paper Analyzer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "paper_analyzer:prefs",
        "category": "workflow",
        "contentTemplate": "For Paper Analyzer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "paper_analyzer:standards",
        "category": "workflow",
        "contentTemplate": "When using Paper Analyzer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "paper_analyzer:handoff",
        "category": "workflow",
        "contentTemplate": "When Paper Analyzer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install paper_analyzer"
  },
  {
    "id": "patent_research",
    "name": "Patent Research",
    "version": "1.0.0",
    "description": "Patent Research delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.",
    "longDescription": "Patent Research delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "research"
    ],
    "tags": [
      "patents",
      "prior-art",
      "claims",
      "ip"
    ],
    "keywords": [
      "patents",
      "prior-art",
      "claims",
      "ip",
      "patent research",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "net",
        "reason": "Patent Research may need web access for source discovery through XR egress controls.",
        "dangerous": true
      },
      {
        "scope": "fs:write",
        "reason": "Patent Research may save reports after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "patent-research",
        "title": "Patent Research",
        "description": "Apply the Patent Research skill to a task.",
        "prompt": "Use the Patent Research skill and produce professional, validated output."
      },
      {
        "name": "patent-research-doctor",
        "title": "Patent Research Doctor",
        "description": "Run the Patent Research Skill quality and readiness checklist.",
        "prompt": "Use Patent Research to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "patent-research",
        "title": "/patent-research",
        "description": "Invoke Patent Research.",
        "prompt": "Invoke the Patent Research skill."
      },
      {
        "name": "patent-research-doctor",
        "title": "/patent-research-doctor",
        "description": "Diagnose readiness with Patent Research.",
        "prompt": "Run Patent Research diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "patent_research:workflow",
        "title": "Patent Research Professional Workflow",
        "description": "Default workflow for Patent Research.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "patent_research:professional-delivery",
        "title": "Patent Research Professional Delivery",
        "description": "End-to-end professional workflow for Patent Research.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Frame the research question, audience, scope, and decision to support.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Plan source strategy across primary, secondary, and contradictory evidence.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Extract claims, methods, dates, metrics, and limitations.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Synthesize findings with confidence and alternative interpretations.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver conclusions, open questions, and recommended next research steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "patent_research:quality-gate",
        "title": "Patent Research Quality Gate",
        "description": "Pre-final validation gate for Patent Research.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "patent_research:prefs",
        "category": "workflow",
        "contentTemplate": "For Patent Research, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "patent_research:standards",
        "category": "workflow",
        "contentTemplate": "When using Patent Research, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "patent_research:handoff",
        "category": "workflow",
        "contentTemplate": "When Patent Research finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install patent_research"
  },
  {
    "id": "pentest_assistant",
    "name": "Pentest Assistant",
    "version": "1.0.0",
    "description": "Pentest Assistant delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.",
    "longDescription": "Pentest Assistant delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "security"
    ],
    "tags": [
      "pentest",
      "authorized",
      "vulnerability",
      "reporting"
    ],
    "keywords": [
      "pentest",
      "authorized",
      "vulnerability",
      "reporting",
      "pentest assistant",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Pentest Assistant may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "pentest-assistant",
        "title": "Pentest Assistant",
        "description": "Apply the Pentest Assistant skill to a task.",
        "prompt": "Use the Pentest Assistant skill and produce professional, validated output."
      },
      {
        "name": "pentest-assistant-doctor",
        "title": "Pentest Assistant Doctor",
        "description": "Run the Pentest Assistant Skill quality and readiness checklist.",
        "prompt": "Use Pentest Assistant to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "pentest-assistant",
        "title": "/pentest-assistant",
        "description": "Invoke Pentest Assistant.",
        "prompt": "Invoke the Pentest Assistant skill."
      },
      {
        "name": "pentest-assistant-doctor",
        "title": "/pentest-assistant-doctor",
        "description": "Diagnose readiness with Pentest Assistant.",
        "prompt": "Run Pentest Assistant diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "pentest_assistant:workflow",
        "title": "Pentest Assistant Professional Workflow",
        "description": "Default workflow for Pentest Assistant.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "pentest_assistant:professional-delivery",
        "title": "Pentest Assistant Professional Delivery",
        "description": "End-to-end professional workflow for Pentest Assistant.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Confirm authorization, scope, assets, timelines, and safety constraints.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Collect and normalize evidence without destroying provenance.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Triage severity, blast radius, affected systems, and likely root cause.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend containment, eradication, recovery, detection, and prevention.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Produce an executive summary plus technical appendix and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "pentest_assistant:quality-gate",
        "title": "Pentest Assistant Quality Gate",
        "description": "Pre-final validation gate for Pentest Assistant.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "pentest_assistant:prefs",
        "category": "workflow",
        "contentTemplate": "For Pentest Assistant, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "pentest_assistant:standards",
        "category": "workflow",
        "contentTemplate": "When using Pentest Assistant, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "pentest_assistant:handoff",
        "category": "workflow",
        "contentTemplate": "When Pentest Assistant finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install pentest_assistant"
  },
  {
    "id": "performance_optimizer",
    "name": "Performance Optimizer",
    "version": "1.0.0",
    "description": "Performance Optimizer delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Performance Optimizer delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "performance",
      "profiling",
      "latency",
      "scaling"
    ],
    "keywords": [
      "performance",
      "profiling",
      "latency",
      "scaling",
      "performance optimizer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Performance Optimizer may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Performance Optimizer may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Performance Optimizer may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "performance-optimizer",
        "title": "Performance Optimizer",
        "description": "Apply the Performance Optimizer skill to a task.",
        "prompt": "Use the Performance Optimizer skill and produce professional, validated output."
      },
      {
        "name": "performance-optimizer-doctor",
        "title": "Performance Optimizer Doctor",
        "description": "Run the Performance Optimizer Skill quality and readiness checklist.",
        "prompt": "Use Performance Optimizer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "performance-optimizer",
        "title": "/performance-optimizer",
        "description": "Invoke Performance Optimizer.",
        "prompt": "Invoke the Performance Optimizer skill."
      },
      {
        "name": "performance-optimizer-doctor",
        "title": "/performance-optimizer-doctor",
        "description": "Diagnose readiness with Performance Optimizer.",
        "prompt": "Run Performance Optimizer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "performance_optimizer:workflow",
        "title": "Performance Optimizer Professional Workflow",
        "description": "Default workflow for Performance Optimizer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "performance_optimizer:professional-delivery",
        "title": "Performance Optimizer Professional Delivery",
        "description": "End-to-end professional workflow for Performance Optimizer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "performance_optimizer:quality-gate",
        "title": "Performance Optimizer Quality Gate",
        "description": "Pre-final validation gate for Performance Optimizer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "performance_optimizer:prefs",
        "category": "workflow",
        "contentTemplate": "For Performance Optimizer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "performance_optimizer:standards",
        "category": "workflow",
        "contentTemplate": "When using Performance Optimizer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "performance_optimizer:handoff",
        "category": "workflow",
        "contentTemplate": "When Performance Optimizer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install performance_optimizer"
  },
  {
    "id": "presentation_builder",
    "name": "Presentation Builder",
    "version": "1.0.0",
    "description": "Presentation Builder delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.",
    "longDescription": "Presentation Builder delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "creative"
    ],
    "tags": [
      "slides",
      "presentation",
      "story",
      "executive"
    ],
    "keywords": [
      "slides",
      "presentation",
      "story",
      "executive",
      "presentation builder",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Presentation Builder may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "presentation-builder",
        "title": "Presentation Builder",
        "description": "Apply the Presentation Builder skill to a task.",
        "prompt": "Use the Presentation Builder skill and produce professional, validated output."
      },
      {
        "name": "presentation-builder-doctor",
        "title": "Presentation Builder Doctor",
        "description": "Run the Presentation Builder Skill quality and readiness checklist.",
        "prompt": "Use Presentation Builder to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "presentation-builder",
        "title": "/presentation-builder",
        "description": "Invoke Presentation Builder.",
        "prompt": "Invoke the Presentation Builder skill."
      },
      {
        "name": "presentation-builder-doctor",
        "title": "/presentation-builder-doctor",
        "description": "Diagnose readiness with Presentation Builder.",
        "prompt": "Run Presentation Builder diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "presentation_builder:workflow",
        "title": "Presentation Builder Professional Workflow",
        "description": "Default workflow for Presentation Builder.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "presentation_builder:professional-delivery",
        "title": "Presentation Builder Professional Delivery",
        "description": "End-to-end professional workflow for Presentation Builder.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Define audience, goal, brand/taste direction, constraints, and deliverable format.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Explore creative territories and select a coherent direction.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Produce polished draft artifacts with rationale.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Critique against audience, clarity, originality, and conversion/usability.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver final version plus variants, usage guidance, and next iteration ideas.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "presentation_builder:quality-gate",
        "title": "Presentation Builder Quality Gate",
        "description": "Pre-final validation gate for Presentation Builder.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "presentation_builder:prefs",
        "category": "workflow",
        "contentTemplate": "For Presentation Builder, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "presentation_builder:standards",
        "category": "workflow",
        "contentTemplate": "When using Presentation Builder, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "presentation_builder:handoff",
        "category": "workflow",
        "contentTemplate": "When Presentation Builder finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install presentation_builder"
  },
  {
    "id": "privacy_advisor",
    "name": "Privacy Advisor",
    "version": "1.0.0",
    "description": "Privacy Advisor delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.",
    "longDescription": "Privacy Advisor delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "security"
    ],
    "tags": [
      "privacy",
      "data-protection",
      "policy",
      "compliance"
    ],
    "keywords": [
      "privacy",
      "data-protection",
      "policy",
      "compliance",
      "privacy advisor",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Privacy Advisor may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "privacy-advisor",
        "title": "Privacy Advisor",
        "description": "Apply the Privacy Advisor skill to a task.",
        "prompt": "Use the Privacy Advisor skill and produce professional, validated output."
      },
      {
        "name": "privacy-advisor-doctor",
        "title": "Privacy Advisor Doctor",
        "description": "Run the Privacy Advisor Skill quality and readiness checklist.",
        "prompt": "Use Privacy Advisor to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "privacy-advisor",
        "title": "/privacy-advisor",
        "description": "Invoke Privacy Advisor.",
        "prompt": "Invoke the Privacy Advisor skill."
      },
      {
        "name": "privacy-advisor-doctor",
        "title": "/privacy-advisor-doctor",
        "description": "Diagnose readiness with Privacy Advisor.",
        "prompt": "Run Privacy Advisor diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "privacy_advisor:workflow",
        "title": "Privacy Advisor Professional Workflow",
        "description": "Default workflow for Privacy Advisor.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "privacy_advisor:professional-delivery",
        "title": "Privacy Advisor Professional Delivery",
        "description": "End-to-end professional workflow for Privacy Advisor.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Confirm authorization, scope, assets, timelines, and safety constraints.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Collect and normalize evidence without destroying provenance.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Triage severity, blast radius, affected systems, and likely root cause.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend containment, eradication, recovery, detection, and prevention.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Produce an executive summary plus technical appendix and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "privacy_advisor:quality-gate",
        "title": "Privacy Advisor Quality Gate",
        "description": "Pre-final validation gate for Privacy Advisor.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "privacy_advisor:prefs",
        "category": "workflow",
        "contentTemplate": "For Privacy Advisor, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "privacy_advisor:standards",
        "category": "workflow",
        "contentTemplate": "When using Privacy Advisor, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "privacy_advisor:handoff",
        "category": "workflow",
        "contentTemplate": "When Privacy Advisor finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install privacy_advisor"
  },
  {
    "id": "product_manager",
    "name": "Product Manager",
    "version": "1.0.0",
    "description": "Product Manager delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "Product Manager delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "product",
      "roadmap",
      "requirements",
      "prioritization"
    ],
    "keywords": [
      "product",
      "roadmap",
      "requirements",
      "prioritization",
      "product manager",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Product Manager may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "product-manager",
        "title": "Product Manager",
        "description": "Apply the Product Manager skill to a task.",
        "prompt": "Use the Product Manager skill and produce professional, validated output."
      },
      {
        "name": "product-manager-doctor",
        "title": "Product Manager Doctor",
        "description": "Run the Product Manager Skill quality and readiness checklist.",
        "prompt": "Use Product Manager to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "product-manager",
        "title": "/product-manager",
        "description": "Invoke Product Manager.",
        "prompt": "Invoke the Product Manager skill."
      },
      {
        "name": "product-manager-doctor",
        "title": "/product-manager-doctor",
        "description": "Diagnose readiness with Product Manager.",
        "prompt": "Run Product Manager diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "product_manager:workflow",
        "title": "Product Manager Professional Workflow",
        "description": "Default workflow for Product Manager.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "product_manager:professional-delivery",
        "title": "Product Manager Professional Delivery",
        "description": "End-to-end professional workflow for Product Manager.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "product_manager:quality-gate",
        "title": "Product Manager Quality Gate",
        "description": "Pre-final validation gate for Product Manager.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "product_manager:prefs",
        "category": "workflow",
        "contentTemplate": "For Product Manager, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "product_manager:standards",
        "category": "workflow",
        "contentTemplate": "When using Product Manager, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "product_manager:handoff",
        "category": "workflow",
        "contentTemplate": "When Product Manager finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install product_manager"
  },
  {
    "id": "project_manager",
    "name": "Project Manager",
    "version": "1.0.0",
    "description": "Project Manager delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "Project Manager delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "project",
      "planning",
      "risk",
      "delivery"
    ],
    "keywords": [
      "project",
      "planning",
      "risk",
      "delivery",
      "project manager",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Project Manager may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "project-manager",
        "title": "Project Manager",
        "description": "Apply the Project Manager skill to a task.",
        "prompt": "Use the Project Manager skill and produce professional, validated output."
      },
      {
        "name": "project-manager-doctor",
        "title": "Project Manager Doctor",
        "description": "Run the Project Manager Skill quality and readiness checklist.",
        "prompt": "Use Project Manager to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "project-manager",
        "title": "/project-manager",
        "description": "Invoke Project Manager.",
        "prompt": "Invoke the Project Manager skill."
      },
      {
        "name": "project-manager-doctor",
        "title": "/project-manager-doctor",
        "description": "Diagnose readiness with Project Manager.",
        "prompt": "Run Project Manager diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "project_manager:workflow",
        "title": "Project Manager Professional Workflow",
        "description": "Default workflow for Project Manager.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "project_manager:professional-delivery",
        "title": "Project Manager Professional Delivery",
        "description": "End-to-end professional workflow for Project Manager.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "project_manager:quality-gate",
        "title": "Project Manager Quality Gate",
        "description": "Pre-final validation gate for Project Manager.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "project_manager:prefs",
        "category": "workflow",
        "contentTemplate": "For Project Manager, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "project_manager:standards",
        "category": "workflow",
        "contentTemplate": "When using Project Manager, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "project_manager:handoff",
        "category": "workflow",
        "contentTemplate": "When Project Manager finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install project_manager"
  },
  {
    "id": "proposal_writer",
    "name": "Proposal Writer",
    "version": "1.0.0",
    "description": "Proposal Writer delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "Proposal Writer delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "proposal",
      "rfp",
      "sales",
      "business"
    ],
    "keywords": [
      "proposal",
      "rfp",
      "sales",
      "business",
      "proposal writer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Proposal Writer may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "proposal-writer",
        "title": "Proposal Writer",
        "description": "Apply the Proposal Writer skill to a task.",
        "prompt": "Use the Proposal Writer skill and produce professional, validated output."
      },
      {
        "name": "proposal-writer-doctor",
        "title": "Proposal Writer Doctor",
        "description": "Run the Proposal Writer Skill quality and readiness checklist.",
        "prompt": "Use Proposal Writer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "proposal-writer",
        "title": "/proposal-writer",
        "description": "Invoke Proposal Writer.",
        "prompt": "Invoke the Proposal Writer skill."
      },
      {
        "name": "proposal-writer-doctor",
        "title": "/proposal-writer-doctor",
        "description": "Diagnose readiness with Proposal Writer.",
        "prompt": "Run Proposal Writer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "proposal_writer:workflow",
        "title": "Proposal Writer Professional Workflow",
        "description": "Default workflow for Proposal Writer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "proposal_writer:professional-delivery",
        "title": "Proposal Writer Professional Delivery",
        "description": "End-to-end professional workflow for Proposal Writer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "proposal_writer:quality-gate",
        "title": "Proposal Writer Quality Gate",
        "description": "Pre-final validation gate for Proposal Writer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "proposal_writer:prefs",
        "category": "workflow",
        "contentTemplate": "For Proposal Writer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "proposal_writer:standards",
        "category": "workflow",
        "contentTemplate": "When using Proposal Writer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "proposal_writer:handoff",
        "category": "workflow",
        "contentTemplate": "When Proposal Writer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install proposal_writer"
  },
  {
    "id": "python_expert",
    "name": "Python Expert",
    "version": "1.0.0",
    "description": "Python Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Python Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "python",
      "automation",
      "data",
      "backend"
    ],
    "keywords": [
      "python",
      "automation",
      "data",
      "backend",
      "python expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Python Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Python Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Python Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "python-expert",
        "title": "Python Expert",
        "description": "Apply the Python Expert skill to a task.",
        "prompt": "Use the Python Expert skill and produce professional, validated output."
      },
      {
        "name": "python-expert-doctor",
        "title": "Python Expert Doctor",
        "description": "Run the Python Expert Skill quality and readiness checklist.",
        "prompt": "Use Python Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "python-expert",
        "title": "/python-expert",
        "description": "Invoke Python Expert.",
        "prompt": "Invoke the Python Expert skill."
      },
      {
        "name": "python-expert-doctor",
        "title": "/python-expert-doctor",
        "description": "Diagnose readiness with Python Expert.",
        "prompt": "Run Python Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "python_expert:workflow",
        "title": "Python Expert Professional Workflow",
        "description": "Default workflow for Python Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "python_expert:professional-delivery",
        "title": "Python Expert Professional Delivery",
        "description": "End-to-end professional workflow for Python Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "python_expert:quality-gate",
        "title": "Python Expert Quality Gate",
        "description": "Pre-final validation gate for Python Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "python_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Python Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "python_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Python Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "python_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Python Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install python_expert"
  },
  {
    "id": "react_expert",
    "name": "React Expert",
    "version": "1.0.0",
    "description": "React Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "React Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "react",
      "components",
      "state",
      "frontend"
    ],
    "keywords": [
      "react",
      "components",
      "state",
      "frontend",
      "react expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "React Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "React Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "React Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "react-expert",
        "title": "React Expert",
        "description": "Apply the React Expert skill to a task.",
        "prompt": "Use the React Expert skill and produce professional, validated output."
      },
      {
        "name": "react-expert-doctor",
        "title": "React Expert Doctor",
        "description": "Run the React Expert Skill quality and readiness checklist.",
        "prompt": "Use React Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "react-expert",
        "title": "/react-expert",
        "description": "Invoke React Expert.",
        "prompt": "Invoke the React Expert skill."
      },
      {
        "name": "react-expert-doctor",
        "title": "/react-expert-doctor",
        "description": "Diagnose readiness with React Expert.",
        "prompt": "Run React Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "react_expert:workflow",
        "title": "React Expert Professional Workflow",
        "description": "Default workflow for React Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "react_expert:professional-delivery",
        "title": "React Expert Professional Delivery",
        "description": "End-to-end professional workflow for React Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "react_expert:quality-gate",
        "title": "React Expert Quality Gate",
        "description": "Pre-final validation gate for React Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "react_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For React Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "react_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using React Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "react_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When React Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install react_expert"
  },
  {
    "id": "refactoring_expert",
    "name": "Refactoring Expert",
    "version": "1.0.0",
    "description": "Refactoring Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Refactoring Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "refactor",
      "clean-code",
      "maintainability",
      "design"
    ],
    "keywords": [
      "refactor",
      "clean-code",
      "maintainability",
      "design",
      "refactoring expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Refactoring Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Refactoring Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Refactoring Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "refactoring-expert",
        "title": "Refactoring Expert",
        "description": "Apply the Refactoring Expert skill to a task.",
        "prompt": "Use the Refactoring Expert skill and produce professional, validated output."
      },
      {
        "name": "refactoring-expert-doctor",
        "title": "Refactoring Expert Doctor",
        "description": "Run the Refactoring Expert Skill quality and readiness checklist.",
        "prompt": "Use Refactoring Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "refactoring-expert",
        "title": "/refactoring-expert",
        "description": "Invoke Refactoring Expert.",
        "prompt": "Invoke the Refactoring Expert skill."
      },
      {
        "name": "refactoring-expert-doctor",
        "title": "/refactoring-expert-doctor",
        "description": "Diagnose readiness with Refactoring Expert.",
        "prompt": "Run Refactoring Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "refactoring_expert:workflow",
        "title": "Refactoring Expert Professional Workflow",
        "description": "Default workflow for Refactoring Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "refactoring_expert:professional-delivery",
        "title": "Refactoring Expert Professional Delivery",
        "description": "End-to-end professional workflow for Refactoring Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "refactoring_expert:quality-gate",
        "title": "Refactoring Expert Quality Gate",
        "description": "Pre-final validation gate for Refactoring Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "refactoring_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Refactoring Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "refactoring_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Refactoring Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "refactoring_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Refactoring Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install refactoring_expert"
  },
  {
    "id": "rust_expert",
    "name": "Rust Expert",
    "version": "1.0.0",
    "description": "Rust Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Rust Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "rust",
      "systems",
      "performance",
      "safety"
    ],
    "keywords": [
      "rust",
      "systems",
      "performance",
      "safety",
      "rust expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Rust Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Rust Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Rust Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "rust-expert",
        "title": "Rust Expert",
        "description": "Apply the Rust Expert skill to a task.",
        "prompt": "Use the Rust Expert skill and produce professional, validated output."
      },
      {
        "name": "rust-expert-doctor",
        "title": "Rust Expert Doctor",
        "description": "Run the Rust Expert Skill quality and readiness checklist.",
        "prompt": "Use Rust Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "rust-expert",
        "title": "/rust-expert",
        "description": "Invoke Rust Expert.",
        "prompt": "Invoke the Rust Expert skill."
      },
      {
        "name": "rust-expert-doctor",
        "title": "/rust-expert-doctor",
        "description": "Diagnose readiness with Rust Expert.",
        "prompt": "Run Rust Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "rust_expert:workflow",
        "title": "Rust Expert Professional Workflow",
        "description": "Default workflow for Rust Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "rust_expert:professional-delivery",
        "title": "Rust Expert Professional Delivery",
        "description": "End-to-end professional workflow for Rust Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "rust_expert:quality-gate",
        "title": "Rust Expert Quality Gate",
        "description": "Pre-final validation gate for Rust Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "rust_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Rust Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "rust_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Rust Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "rust_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Rust Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install rust_expert"
  },
  {
    "id": "seo_expert",
    "name": "SEO Expert",
    "version": "1.0.0",
    "description": "SEO Expert delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "SEO Expert delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "seo",
      "content",
      "technical-seo",
      "search"
    ],
    "keywords": [
      "seo",
      "content",
      "technical-seo",
      "search",
      "seo expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "SEO Expert may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "seo-expert",
        "title": "SEO Expert",
        "description": "Apply the SEO Expert skill to a task.",
        "prompt": "Use the SEO Expert skill and produce professional, validated output."
      },
      {
        "name": "seo-expert-doctor",
        "title": "SEO Expert Doctor",
        "description": "Run the SEO Expert Skill quality and readiness checklist.",
        "prompt": "Use SEO Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "seo-expert",
        "title": "/seo-expert",
        "description": "Invoke SEO Expert.",
        "prompt": "Invoke the SEO Expert skill."
      },
      {
        "name": "seo-expert-doctor",
        "title": "/seo-expert-doctor",
        "description": "Diagnose readiness with SEO Expert.",
        "prompt": "Run SEO Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "seo_expert:workflow",
        "title": "SEO Expert Professional Workflow",
        "description": "Default workflow for SEO Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "seo_expert:professional-delivery",
        "title": "SEO Expert Professional Delivery",
        "description": "End-to-end professional workflow for SEO Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "seo_expert:quality-gate",
        "title": "SEO Expert Quality Gate",
        "description": "Pre-final validation gate for SEO Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "seo_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For SEO Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "seo_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using SEO Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "seo_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When SEO Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install seo_expert"
  },
  {
    "id": "soc_analyst",
    "name": "SOC Analyst",
    "version": "1.0.0",
    "description": "SOC Analyst delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.",
    "longDescription": "SOC Analyst delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "security"
    ],
    "tags": [
      "soc",
      "alerts",
      "siem",
      "triage"
    ],
    "keywords": [
      "soc",
      "alerts",
      "siem",
      "triage",
      "soc analyst",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "SOC Analyst may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "soc-analyst",
        "title": "SOC Analyst",
        "description": "Apply the SOC Analyst skill to a task.",
        "prompt": "Use the SOC Analyst skill and produce professional, validated output."
      },
      {
        "name": "soc-analyst-doctor",
        "title": "SOC Analyst Doctor",
        "description": "Run the SOC Analyst Skill quality and readiness checklist.",
        "prompt": "Use SOC Analyst to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "soc-analyst",
        "title": "/soc-analyst",
        "description": "Invoke SOC Analyst.",
        "prompt": "Invoke the SOC Analyst skill."
      },
      {
        "name": "soc-analyst-doctor",
        "title": "/soc-analyst-doctor",
        "description": "Diagnose readiness with SOC Analyst.",
        "prompt": "Run SOC Analyst diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "soc_analyst:workflow",
        "title": "SOC Analyst Professional Workflow",
        "description": "Default workflow for SOC Analyst.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "soc_analyst:professional-delivery",
        "title": "SOC Analyst Professional Delivery",
        "description": "End-to-end professional workflow for SOC Analyst.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Confirm authorization, scope, assets, timelines, and safety constraints.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Collect and normalize evidence without destroying provenance.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Triage severity, blast radius, affected systems, and likely root cause.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend containment, eradication, recovery, detection, and prevention.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Produce an executive summary plus technical appendix and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "soc_analyst:quality-gate",
        "title": "SOC Analyst Quality Gate",
        "description": "Pre-final validation gate for SOC Analyst.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "soc_analyst:prefs",
        "category": "workflow",
        "contentTemplate": "For SOC Analyst, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "soc_analyst:standards",
        "category": "workflow",
        "contentTemplate": "When using SOC Analyst, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "soc_analyst:handoff",
        "category": "workflow",
        "contentTemplate": "When SOC Analyst finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install soc_analyst"
  },
  {
    "id": "sales_agent",
    "name": "Sales Agent",
    "version": "1.0.0",
    "description": "Sales Agent delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "Sales Agent delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "sales",
      "pipeline",
      "outreach",
      "qualification"
    ],
    "keywords": [
      "sales",
      "pipeline",
      "outreach",
      "qualification",
      "sales agent",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Sales Agent may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "sales-agent",
        "title": "Sales Agent",
        "description": "Apply the Sales Agent skill to a task.",
        "prompt": "Use the Sales Agent skill and produce professional, validated output."
      },
      {
        "name": "sales-agent-doctor",
        "title": "Sales Agent Doctor",
        "description": "Run the Sales Agent Skill quality and readiness checklist.",
        "prompt": "Use Sales Agent to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "sales-agent",
        "title": "/sales-agent",
        "description": "Invoke Sales Agent.",
        "prompt": "Invoke the Sales Agent skill."
      },
      {
        "name": "sales-agent-doctor",
        "title": "/sales-agent-doctor",
        "description": "Diagnose readiness with Sales Agent.",
        "prompt": "Run Sales Agent diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "sales_agent:workflow",
        "title": "Sales Agent Professional Workflow",
        "description": "Default workflow for Sales Agent.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "sales_agent:professional-delivery",
        "title": "Sales Agent Professional Delivery",
        "description": "End-to-end professional workflow for Sales Agent.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "sales_agent:quality-gate",
        "title": "Sales Agent Quality Gate",
        "description": "Pre-final validation gate for Sales Agent.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "sales_agent:prefs",
        "category": "workflow",
        "contentTemplate": "For Sales Agent, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "sales_agent:standards",
        "category": "workflow",
        "contentTemplate": "When using Sales Agent, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "sales_agent:handoff",
        "category": "workflow",
        "contentTemplate": "When Sales Agent finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install sales_agent"
  },
  {
    "id": "scientific_research",
    "name": "Scientific Research",
    "version": "1.0.0",
    "description": "Scientific Research delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.",
    "longDescription": "Scientific Research delivers source-aware research synthesis with evidence grading, uncertainty tracking, and clear conclusions.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "research"
    ],
    "tags": [
      "science",
      "hypothesis",
      "evidence",
      "experiment"
    ],
    "keywords": [
      "science",
      "hypothesis",
      "evidence",
      "experiment",
      "scientific research",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "net",
        "reason": "Scientific Research may need web access for source discovery through XR egress controls.",
        "dangerous": true
      },
      {
        "scope": "fs:write",
        "reason": "Scientific Research may save reports after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "scientific-research",
        "title": "Scientific Research",
        "description": "Apply the Scientific Research skill to a task.",
        "prompt": "Use the Scientific Research skill and produce professional, validated output."
      },
      {
        "name": "scientific-research-doctor",
        "title": "Scientific Research Doctor",
        "description": "Run the Scientific Research Skill quality and readiness checklist.",
        "prompt": "Use Scientific Research to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "scientific-research",
        "title": "/scientific-research",
        "description": "Invoke Scientific Research.",
        "prompt": "Invoke the Scientific Research skill."
      },
      {
        "name": "scientific-research-doctor",
        "title": "/scientific-research-doctor",
        "description": "Diagnose readiness with Scientific Research.",
        "prompt": "Run Scientific Research diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "scientific_research:workflow",
        "title": "Scientific Research Professional Workflow",
        "description": "Default workflow for Scientific Research.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "scientific_research:professional-delivery",
        "title": "Scientific Research Professional Delivery",
        "description": "End-to-end professional workflow for Scientific Research.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Frame the research question, audience, scope, and decision to support.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Plan source strategy across primary, secondary, and contradictory evidence.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Extract claims, methods, dates, metrics, and limitations.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Synthesize findings with confidence and alternative interpretations.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver conclusions, open questions, and recommended next research steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "scientific_research:quality-gate",
        "title": "Scientific Research Quality Gate",
        "description": "Pre-final validation gate for Scientific Research.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "scientific_research:prefs",
        "category": "workflow",
        "contentTemplate": "For Scientific Research, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "scientific_research:standards",
        "category": "workflow",
        "contentTemplate": "When using Scientific Research, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "scientific_research:handoff",
        "category": "workflow",
        "contentTemplate": "When Scientific Research finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install scientific_research"
  },
  {
    "id": "social_media_creator",
    "name": "Social Media Creator",
    "version": "1.0.0",
    "description": "Social Media Creator delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.",
    "longDescription": "Social Media Creator delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "creative"
    ],
    "tags": [
      "social",
      "posts",
      "platforms",
      "engagement"
    ],
    "keywords": [
      "social",
      "posts",
      "platforms",
      "engagement",
      "social media creator",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Social Media Creator may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "social-media-creator",
        "title": "Social Media Creator",
        "description": "Apply the Social Media Creator skill to a task.",
        "prompt": "Use the Social Media Creator skill and produce professional, validated output."
      },
      {
        "name": "social-media-creator-doctor",
        "title": "Social Media Creator Doctor",
        "description": "Run the Social Media Creator Skill quality and readiness checklist.",
        "prompt": "Use Social Media Creator to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "social-media-creator",
        "title": "/social-media-creator",
        "description": "Invoke Social Media Creator.",
        "prompt": "Invoke the Social Media Creator skill."
      },
      {
        "name": "social-media-creator-doctor",
        "title": "/social-media-creator-doctor",
        "description": "Diagnose readiness with Social Media Creator.",
        "prompt": "Run Social Media Creator diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "social_media_creator:workflow",
        "title": "Social Media Creator Professional Workflow",
        "description": "Default workflow for Social Media Creator.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "social_media_creator:professional-delivery",
        "title": "Social Media Creator Professional Delivery",
        "description": "End-to-end professional workflow for Social Media Creator.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Define audience, goal, brand/taste direction, constraints, and deliverable format.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Explore creative territories and select a coherent direction.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Produce polished draft artifacts with rationale.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Critique against audience, clarity, originality, and conversion/usability.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver final version plus variants, usage guidance, and next iteration ideas.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "social_media_creator:quality-gate",
        "title": "Social Media Creator Quality Gate",
        "description": "Pre-final validation gate for Social Media Creator.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "social_media_creator:prefs",
        "category": "workflow",
        "contentTemplate": "For Social Media Creator, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "social_media_creator:standards",
        "category": "workflow",
        "contentTemplate": "When using Social Media Creator, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "social_media_creator:handoff",
        "category": "workflow",
        "contentTemplate": "When Social Media Creator finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install social_media_creator"
  },
  {
    "id": "startup_advisor",
    "name": "Startup Advisor",
    "version": "1.0.0",
    "description": "Startup Advisor delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.",
    "longDescription": "Startup Advisor delivers practical business output with market context, metrics, stakeholder clarity, and execution focus.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "business"
    ],
    "tags": [
      "startup",
      "strategy",
      "fundraising",
      "gtm"
    ],
    "keywords": [
      "startup",
      "strategy",
      "fundraising",
      "gtm",
      "startup advisor",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Startup Advisor may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "startup-advisor",
        "title": "Startup Advisor",
        "description": "Apply the Startup Advisor skill to a task.",
        "prompt": "Use the Startup Advisor skill and produce professional, validated output."
      },
      {
        "name": "startup-advisor-doctor",
        "title": "Startup Advisor Doctor",
        "description": "Run the Startup Advisor Skill quality and readiness checklist.",
        "prompt": "Use Startup Advisor to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "startup-advisor",
        "title": "/startup-advisor",
        "description": "Invoke Startup Advisor.",
        "prompt": "Invoke the Startup Advisor skill."
      },
      {
        "name": "startup-advisor-doctor",
        "title": "/startup-advisor-doctor",
        "description": "Diagnose readiness with Startup Advisor.",
        "prompt": "Run Startup Advisor diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "startup_advisor:workflow",
        "title": "Startup Advisor Professional Workflow",
        "description": "Default workflow for Startup Advisor.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "startup_advisor:professional-delivery",
        "title": "Startup Advisor Professional Delivery",
        "description": "End-to-end professional workflow for Startup Advisor.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Clarify objective, market/customer context, constraints, and success metrics.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Diagnose current state and key bottlenecks.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Generate options with trade-offs, costs, risks, and expected impact.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend a prioritized plan with metrics and owner-ready next steps.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Create an executive-ready deliverable and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "startup_advisor:quality-gate",
        "title": "Startup Advisor Quality Gate",
        "description": "Pre-final validation gate for Startup Advisor.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "startup_advisor:prefs",
        "category": "workflow",
        "contentTemplate": "For Startup Advisor, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "startup_advisor:standards",
        "category": "workflow",
        "contentTemplate": "When using Startup Advisor, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "startup_advisor:handoff",
        "category": "workflow",
        "contentTemplate": "When Startup Advisor finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install startup_advisor"
  },
  {
    "id": "story_writer",
    "name": "Story Writer",
    "version": "1.0.0",
    "description": "Story Writer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.",
    "longDescription": "Story Writer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "creative"
    ],
    "tags": [
      "story",
      "narrative",
      "characters",
      "editing"
    ],
    "keywords": [
      "story",
      "narrative",
      "characters",
      "editing",
      "story writer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Story Writer may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "story-writer",
        "title": "Story Writer",
        "description": "Apply the Story Writer skill to a task.",
        "prompt": "Use the Story Writer skill and produce professional, validated output."
      },
      {
        "name": "story-writer-doctor",
        "title": "Story Writer Doctor",
        "description": "Run the Story Writer Skill quality and readiness checklist.",
        "prompt": "Use Story Writer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "story-writer",
        "title": "/story-writer",
        "description": "Invoke Story Writer.",
        "prompt": "Invoke the Story Writer skill."
      },
      {
        "name": "story-writer-doctor",
        "title": "/story-writer-doctor",
        "description": "Diagnose readiness with Story Writer.",
        "prompt": "Run Story Writer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "story_writer:workflow",
        "title": "Story Writer Professional Workflow",
        "description": "Default workflow for Story Writer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "story_writer:professional-delivery",
        "title": "Story Writer Professional Delivery",
        "description": "End-to-end professional workflow for Story Writer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Define audience, goal, brand/taste direction, constraints, and deliverable format.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Explore creative territories and select a coherent direction.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Produce polished draft artifacts with rationale.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Critique against audience, clarity, originality, and conversion/usability.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver final version plus variants, usage guidance, and next iteration ideas.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "story_writer:quality-gate",
        "title": "Story Writer Quality Gate",
        "description": "Pre-final validation gate for Story Writer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "story_writer:prefs",
        "category": "workflow",
        "contentTemplate": "For Story Writer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "story_writer:standards",
        "category": "workflow",
        "contentTemplate": "When using Story Writer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "story_writer:handoff",
        "category": "workflow",
        "contentTemplate": "When Story Writer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install story_writer"
  },
  {
    "id": "testing_expert",
    "name": "Testing Expert",
    "version": "1.0.0",
    "description": "Testing Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.",
    "longDescription": "Testing Expert delivers production-grade technical work with clear architecture, tests, maintainability, and operational awareness.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "developer"
    ],
    "tags": [
      "tests",
      "qa",
      "coverage",
      "automation"
    ],
    "keywords": [
      "tests",
      "qa",
      "coverage",
      "automation",
      "testing expert",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:read",
        "reason": "Testing Expert may need to inspect project files.",
        "dangerous": false
      },
      {
        "scope": "fs:write",
        "reason": "Testing Expert may produce or edit project files only after approval.",
        "dangerous": true
      },
      {
        "scope": "shell",
        "reason": "Testing Expert may run local validation commands only after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "testing-expert",
        "title": "Testing Expert",
        "description": "Apply the Testing Expert skill to a task.",
        "prompt": "Use the Testing Expert skill and produce professional, validated output."
      },
      {
        "name": "testing-expert-doctor",
        "title": "Testing Expert Doctor",
        "description": "Run the Testing Expert Skill quality and readiness checklist.",
        "prompt": "Use Testing Expert to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "testing-expert",
        "title": "/testing-expert",
        "description": "Invoke Testing Expert.",
        "prompt": "Invoke the Testing Expert skill."
      },
      {
        "name": "testing-expert-doctor",
        "title": "/testing-expert-doctor",
        "description": "Diagnose readiness with Testing Expert.",
        "prompt": "Run Testing Expert diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "testing_expert:workflow",
        "title": "Testing Expert Professional Workflow",
        "description": "Default workflow for Testing Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "testing_expert:professional-delivery",
        "title": "Testing Expert Professional Delivery",
        "description": "End-to-end professional workflow for Testing Expert.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Map the codebase surface, inputs, outputs, constraints, and owner expectations.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Identify the smallest safe implementation path and the tests that prove it.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Implement or describe changes with attention to maintainability, security, and performance.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Run or recommend validation commands and capture failures precisely.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Handoff with changed files, rationale, risks, and next steps.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "testing_expert:quality-gate",
        "title": "Testing Expert Quality Gate",
        "description": "Pre-final validation gate for Testing Expert.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "testing_expert:prefs",
        "category": "workflow",
        "contentTemplate": "For Testing Expert, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "testing_expert:standards",
        "category": "workflow",
        "contentTemplate": "When using Testing Expert, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "testing_expert:handoff",
        "category": "workflow",
        "contentTemplate": "When Testing Expert finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install testing_expert"
  },
  {
    "id": "threat_hunter",
    "name": "Threat Hunter",
    "version": "1.0.0",
    "description": "Threat Hunter delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.",
    "longDescription": "Threat Hunter delivers defensive, authorized, auditable security analysis with explicit scope boundaries and risk handling.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "security"
    ],
    "tags": [
      "threat-hunting",
      "detection",
      "logs",
      "security"
    ],
    "keywords": [
      "threat-hunting",
      "detection",
      "logs",
      "security",
      "threat hunter",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Threat Hunter may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "threat-hunter",
        "title": "Threat Hunter",
        "description": "Apply the Threat Hunter skill to a task.",
        "prompt": "Use the Threat Hunter skill and produce professional, validated output."
      },
      {
        "name": "threat-hunter-doctor",
        "title": "Threat Hunter Doctor",
        "description": "Run the Threat Hunter Skill quality and readiness checklist.",
        "prompt": "Use Threat Hunter to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "threat-hunter",
        "title": "/threat-hunter",
        "description": "Invoke Threat Hunter.",
        "prompt": "Invoke the Threat Hunter skill."
      },
      {
        "name": "threat-hunter-doctor",
        "title": "/threat-hunter-doctor",
        "description": "Diagnose readiness with Threat Hunter.",
        "prompt": "Run Threat Hunter diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "threat_hunter:workflow",
        "title": "Threat Hunter Professional Workflow",
        "description": "Default workflow for Threat Hunter.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "threat_hunter:professional-delivery",
        "title": "Threat Hunter Professional Delivery",
        "description": "End-to-end professional workflow for Threat Hunter.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Confirm authorization, scope, assets, timelines, and safety constraints.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Collect and normalize evidence without destroying provenance.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Triage severity, blast radius, affected systems, and likely root cause.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Recommend containment, eradication, recovery, detection, and prevention.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Produce an executive summary plus technical appendix and validation checklist.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "threat_hunter:quality-gate",
        "title": "Threat Hunter Quality Gate",
        "description": "Pre-final validation gate for Threat Hunter.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "threat_hunter:prefs",
        "category": "workflow",
        "contentTemplate": "For Threat Hunter, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "threat_hunter:standards",
        "category": "workflow",
        "contentTemplate": "When using Threat Hunter, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "threat_hunter:handoff",
        "category": "workflow",
        "contentTemplate": "When Threat Hunter finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install threat_hunter"
  },
  {
    "id": "ui_designer",
    "name": "UI Designer",
    "version": "1.0.0",
    "description": "UI Designer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.",
    "longDescription": "UI Designer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "creative"
    ],
    "tags": [
      "ui",
      "visual-design",
      "interfaces",
      "design-system"
    ],
    "keywords": [
      "ui",
      "visual-design",
      "interfaces",
      "design-system",
      "ui designer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "UI Designer may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "ui-designer",
        "title": "UI Designer",
        "description": "Apply the UI Designer skill to a task.",
        "prompt": "Use the UI Designer skill and produce professional, validated output."
      },
      {
        "name": "ui-designer-doctor",
        "title": "UI Designer Doctor",
        "description": "Run the UI Designer Skill quality and readiness checklist.",
        "prompt": "Use UI Designer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "ui-designer",
        "title": "/ui-designer",
        "description": "Invoke UI Designer.",
        "prompt": "Invoke the UI Designer skill."
      },
      {
        "name": "ui-designer-doctor",
        "title": "/ui-designer-doctor",
        "description": "Diagnose readiness with UI Designer.",
        "prompt": "Run UI Designer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "ui_designer:workflow",
        "title": "UI Designer Professional Workflow",
        "description": "Default workflow for UI Designer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "ui_designer:professional-delivery",
        "title": "UI Designer Professional Delivery",
        "description": "End-to-end professional workflow for UI Designer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Define audience, goal, brand/taste direction, constraints, and deliverable format.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Explore creative territories and select a coherent direction.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Produce polished draft artifacts with rationale.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Critique against audience, clarity, originality, and conversion/usability.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver final version plus variants, usage guidance, and next iteration ideas.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "ui_designer:quality-gate",
        "title": "UI Designer Quality Gate",
        "description": "Pre-final validation gate for UI Designer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "ui_designer:prefs",
        "category": "workflow",
        "contentTemplate": "For UI Designer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "ui_designer:standards",
        "category": "workflow",
        "contentTemplate": "When using UI Designer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "ui_designer:handoff",
        "category": "workflow",
        "contentTemplate": "When UI Designer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install ui_designer"
  },
  {
    "id": "ux_designer",
    "name": "UX Designer",
    "version": "1.0.0",
    "description": "UX Designer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.",
    "longDescription": "UX Designer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "creative"
    ],
    "tags": [
      "ux",
      "research",
      "flows",
      "usability"
    ],
    "keywords": [
      "ux",
      "research",
      "flows",
      "usability",
      "ux designer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "UX Designer may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "ux-designer",
        "title": "UX Designer",
        "description": "Apply the UX Designer skill to a task.",
        "prompt": "Use the UX Designer skill and produce professional, validated output."
      },
      {
        "name": "ux-designer-doctor",
        "title": "UX Designer Doctor",
        "description": "Run the UX Designer Skill quality and readiness checklist.",
        "prompt": "Use UX Designer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "ux-designer",
        "title": "/ux-designer",
        "description": "Invoke UX Designer.",
        "prompt": "Invoke the UX Designer skill."
      },
      {
        "name": "ux-designer-doctor",
        "title": "/ux-designer-doctor",
        "description": "Diagnose readiness with UX Designer.",
        "prompt": "Run UX Designer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "ux_designer:workflow",
        "title": "UX Designer Professional Workflow",
        "description": "Default workflow for UX Designer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "ux_designer:professional-delivery",
        "title": "UX Designer Professional Delivery",
        "description": "End-to-end professional workflow for UX Designer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Define audience, goal, brand/taste direction, constraints, and deliverable format.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Explore creative territories and select a coherent direction.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Produce polished draft artifacts with rationale.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Critique against audience, clarity, originality, and conversion/usability.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver final version plus variants, usage guidance, and next iteration ideas.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "ux_designer:quality-gate",
        "title": "UX Designer Quality Gate",
        "description": "Pre-final validation gate for UX Designer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "ux_designer:prefs",
        "category": "workflow",
        "contentTemplate": "For UX Designer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "ux_designer:standards",
        "category": "workflow",
        "contentTemplate": "When using UX Designer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "ux_designer:handoff",
        "category": "workflow",
        "contentTemplate": "When UX Designer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install ux_designer"
  },
  {
    "id": "video_script_writer",
    "name": "Video Script Writer",
    "version": "1.0.0",
    "description": "Video Script Writer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.",
    "longDescription": "Video Script Writer delivers distinctive creative work grounded in audience, constraints, taste, iteration, and execution quality.\n\nThis official XR professional skill packages role instructions, reasoning policy, workflows, examples, validation tests, memory templates, and safe permission declarations so users can make XR smarter without writing code.\n\nXR 2.1E official Skill hardening: includes a professional playbook, diagnostic prompt, operating manual, permission docs, quality tests, advanced examples, quality-gate workflow, and memory templates.",
    "publisher": "xr-official",
    "license": "MIT",
    "categories": [
      "creative"
    ],
    "tags": [
      "video",
      "script",
      "storyboard",
      "content"
    ],
    "keywords": [
      "video",
      "script",
      "storyboard",
      "content",
      "video script writer",
      "professional",
      "xr"
    ],
    "verification": "official",
    "permissions": [
      {
        "scope": "fs:write",
        "reason": "Video Script Writer may save generated deliverables after approval.",
        "dangerous": true
      }
    ],
    "dependencies": [],
    "commands": [
      {
        "name": "video-script-writer",
        "title": "Video Script Writer",
        "description": "Apply the Video Script Writer skill to a task.",
        "prompt": "Use the Video Script Writer skill and produce professional, validated output."
      },
      {
        "name": "video-script-writer-doctor",
        "title": "Video Script Writer Doctor",
        "description": "Run the Video Script Writer Skill quality and readiness checklist.",
        "prompt": "Use Video Script Writer to inspect the current task or artifact and return readiness, risks, validation gaps, and next actions."
      },
      {
        "name": "video-script-writer",
        "title": "/video-script-writer",
        "description": "Invoke Video Script Writer.",
        "prompt": "Invoke the Video Script Writer skill."
      },
      {
        "name": "video-script-writer-doctor",
        "title": "/video-script-writer-doctor",
        "description": "Diagnose readiness with Video Script Writer.",
        "prompt": "Run Video Script Writer diagnostic mode before final output."
      }
    ],
    "workflows": [
      {
        "id": "video_script_writer:workflow",
        "title": "Video Script Writer Professional Workflow",
        "description": "Default workflow for Video Script Writer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Identify objective, audience, constraints, available inputs, risk level, and acceptance criteria.",
            "expectedOutput": "A clear task brief."
          },
          {
            "id": "plan",
            "title": "Plan",
            "instruction": "Choose the smallest professional workflow that can satisfy the brief; call out assumptions and required approvals.",
            "expectedOutput": "A short execution plan."
          },
          {
            "id": "execute",
            "title": "Execute",
            "instruction": "Produce the work product with domain best practices, traceable decisions, and no unsafe hidden behavior.",
            "expectedOutput": "The requested deliverable."
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Check completeness, correctness, safety, edge cases, and user-specific constraints before final handoff.",
            "expectedOutput": "Validation checklist and residual risks."
          }
        ]
      },
      {
        "id": "video_script_writer:professional-delivery",
        "title": "Video Script Writer Professional Delivery",
        "description": "End-to-end professional workflow for Video Script Writer.",
        "steps": [
          {
            "id": "intake",
            "title": "Intake",
            "instruction": "Define audience, goal, brand/taste direction, constraints, and deliverable format.",
            "expectedOutput": "Task brief and acceptance criteria"
          },
          {
            "id": "diagnose",
            "title": "Diagnose",
            "instruction": "Explore creative territories and select a coherent direction.",
            "expectedOutput": "Diagnosis with assumptions and risks"
          },
          {
            "id": "produce",
            "title": "Produce",
            "instruction": "Produce polished draft artifacts with rationale.",
            "expectedOutput": "Professional work product"
          },
          {
            "id": "validate",
            "title": "Validate",
            "instruction": "Critique against audience, clarity, originality, and conversion/usability.",
            "expectedOutput": "Validation checklist"
          },
          {
            "id": "handoff",
            "title": "Handoff",
            "instruction": "Deliver final version plus variants, usage guidance, and next iteration ideas.",
            "expectedOutput": "Reusable handoff summary"
          }
        ]
      },
      {
        "id": "video_script_writer:quality-gate",
        "title": "Video Script Writer Quality Gate",
        "description": "Pre-final validation gate for Video Script Writer.",
        "steps": [
          {
            "id": "scope-check",
            "title": "Scope Check",
            "instruction": "Confirm the output stays within user intent, authorization, and declared permissions.",
            "expectedOutput": "Scope status"
          },
          {
            "id": "evidence-check",
            "title": "Evidence Check",
            "instruction": "Separate facts, assumptions, estimates, and recommendations.",
            "expectedOutput": "Evidence notes"
          },
          {
            "id": "risk-check",
            "title": "Risk Check",
            "instruction": "List operational, security, privacy, quality, and stakeholder risks.",
            "expectedOutput": "Risk register"
          },
          {
            "id": "finalize",
            "title": "Finalize",
            "instruction": "Produce the final answer with validation and next steps.",
            "expectedOutput": "Final deliverable"
          }
        ]
      }
    ],
    "memoryTemplates": [
      {
        "id": "video_script_writer:prefs",
        "category": "workflow",
        "contentTemplate": "For Video Script Writer, remember the user's preferred output format, standards, and recurring constraints.",
        "scope": "project",
        "importance": 3
      },
      {
        "id": "video_script_writer:standards",
        "category": "workflow",
        "contentTemplate": "When using Video Script Writer, remember project-specific quality standards, constraints, and preferred validation methods.",
        "scope": "project",
        "importance": 4
      },
      {
        "id": "video_script_writer:handoff",
        "category": "workflow",
        "contentTemplate": "When Video Script Writer finishes, remember reusable handoff format, recurring risks, and accepted output structure.",
        "scope": "project",
        "importance": 3
      }
    ],
    "docs": [
      "README.md",
      "docs/operating-manual.md",
      "docs/permissions.md"
    ],
    "examples": [
      "examples/basic.md",
      "examples/professional.md"
    ],
    "tests": [
      "tests/selection.md",
      "tests/quality.md",
      "tests/permissions.md"
    ],
    "kind": "official",
    "installCommand": "xr skill install video_script_writer"
  },
  {
    "id": "api_design",
    "name": "Api Design",
    "version": "1",
    "description": "API Design",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "read_file",
      "web_search"
    ],
    "keywords": [
      "api_design",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "api-design",
        "title": "Api Design",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install api_design"
  },
  {
    "id": "daily-brief",
    "name": "Daily Brief",
    "version": "1",
    "description": "Daily Brief",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "read_file",
      "write_file"
    ],
    "keywords": [
      "daily-brief",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "daily-brief",
        "title": "Daily-Brief",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install daily-brief"
  },
  {
    "id": "db_migrate",
    "name": "Db Migrate",
    "version": "1",
    "description": "DB Migrate",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "read_file",
      "write_file"
    ],
    "keywords": [
      "db_migrate",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "db-migrate",
        "title": "Db Migrate",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install db_migrate"
  },
  {
    "id": "debug_error",
    "name": "Debug Error",
    "version": "1",
    "description": "Debug Error",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "read_file",
      "list_dir",
      "web_search"
    ],
    "keywords": [
      "debug_error",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "debug-error",
        "title": "Debug Error",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install debug_error"
  },
  {
    "id": "explain_codebase",
    "name": "Explain Codebase",
    "version": "1",
    "description": "Explain Codebase",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "list_dir",
      "read_file"
    ],
    "keywords": [
      "explain_codebase",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "explain-codebase",
        "title": "Explain Codebase",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install explain_codebase"
  },
  {
    "id": "generate_readme",
    "name": "Generate Readme",
    "version": "1",
    "description": "Generate README",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "list_dir",
      "read_file",
      "write_file"
    ],
    "keywords": [
      "generate_readme",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "generate-readme",
        "title": "Generate Readme",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install generate_readme"
  },
  {
    "id": "git_commit_message",
    "name": "Git Commit Message",
    "version": "1",
    "description": "Git Commit Message",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "shell"
    ],
    "keywords": [
      "git_commit_message",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "git-commit-message",
        "title": "Git Commit Message",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install git_commit_message"
  },
  {
    "id": "pr_description",
    "name": "Pr Description",
    "version": "1",
    "description": "PR Description",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "shell",
      "read_file"
    ],
    "keywords": [
      "pr_description",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "pr-description",
        "title": "Pr Description",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install pr_description"
  },
  {
    "id": "refactor_clean",
    "name": "Refactor Clean",
    "version": "1",
    "description": "Refactor Clean",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "read_file",
      "write_file"
    ],
    "keywords": [
      "refactor_clean",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "refactor-clean",
        "title": "Refactor Clean",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install refactor_clean"
  },
  {
    "id": "security_audit",
    "name": "Security Audit",
    "version": "1",
    "description": "Security Audit",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "list_dir",
      "read_file"
    ],
    "keywords": [
      "security_audit",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "security-audit",
        "title": "Security Audit",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install security_audit"
  },
  {
    "id": "write_tests",
    "name": "Write Tests",
    "version": "1",
    "description": "Write Tests",
    "longDescription": "Legacy SKILL.md capability adapted into XR Marketplace.",
    "publisher": "xr-legacy",
    "license": "MIT",
    "categories": [
      "workflow"
    ],
    "tags": [
      "read_file",
      "write_file"
    ],
    "keywords": [
      "write_tests",
      "legacy",
      "skill"
    ],
    "verification": "community",
    "permissions": [],
    "dependencies": [],
    "commands": [
      {
        "name": "write-tests",
        "title": "Write Tests",
        "description": "Invoke this legacy Skill."
      }
    ],
    "workflows": [],
    "memoryTemplates": [],
    "docs": [],
    "examples": [],
    "tests": [],
    "kind": "legacy",
    "installCommand": "xr skill install write_tests"
  }
] satisfies MarketplaceSkill[];

export const marketplaceStats = {
  total: marketplaceSkills.length,
  official: marketplaceSkills.filter((s) => s.verification === "official").length,
  legacy: marketplaceSkills.filter((s) => s.kind === "legacy").length,
  categories: Array.from(new Set(marketplaceSkills.flatMap((s) => s.categories))).sort(),
};
