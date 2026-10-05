import { createHashRouter, Navigate } from 'react-router-dom';

import { AppShell } from '@/components/layout/AppShell';
import {
  OnboardingGate,
  OnboardingScreen,
} from '@/screens/Onboarding/OnboardingScreen';
import AgentsScreen from '@/screens/Agents';
import BrainScreen from '@/screens/Brain';
import BudgetScreen from '@/screens/Budget';
import BuilderScreen from '@/screens/Builder';
import ChatScreen from '@/screens/Chat';
import IntegrationsScreen from '@/screens/Integrations';
import MemoryScreen from '@/screens/Memory';
import ResearchScreen from '@/screens/Research';
import RunsScreen from '@/screens/Runs';
import SettingsScreen from '@/screens/Settings';
import ShieldScreen from '@/screens/Shield';
import SkillsStoreScreen from '@/screens/SkillsStore';
import VoiceScreen from '@/screens/Voice';
import WorkspaceLanding from '@/screens/WorkspaceLanding';
import WorkspacesScreen from '@/screens/Workspaces';

/**
 * Hash-based routing: reload-safe inside the Tauri webview (the custom
 * protocol serves exactly one document) and identical in the browser preview.
 * Deep links (`xr://`) are translated to hash routes in a later phase.
 */
export const router = createHashRouter([
  {
    path: '/onboarding',
    element: <OnboardingScreen />,
  },
  {
    element: (
      <OnboardingGate>
        <AppShell />
      </OnboardingGate>
    ),
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: '/chat/:sessionId?', element: <ChatScreen /> },
      { path: '/brain/:runId?', element: <BrainScreen /> },
      { path: '/workspaces', element: <WorkspacesScreen /> },
      { path: '/workspaces/:id', element: <WorkspaceLanding /> },
      { path: '/builder/:workspaceId?', element: <BuilderScreen /> },
      { path: '/research', element: <ResearchScreen /> },
      { path: '/agents', element: <AgentsScreen /> },
      { path: '/skills', element: <SkillsStoreScreen /> },
      { path: '/shield', element: <ShieldScreen /> },
      { path: '/runs', element: <RunsScreen /> },
      { path: '/memory', element: <MemoryScreen /> },
      { path: '/budget', element: <BudgetScreen /> },
      { path: '/integrations', element: <IntegrationsScreen /> },
      { path: '/voice', element: <VoiceScreen /> },
      { path: '/settings', element: <SettingsScreen /> },
      { path: '*', element: <Navigate to="/chat" replace /> },
    ],
  },
  // Dev-only brand QA gallery — stripped from production builds.
  ...(import.meta.env.DEV
    ? [
        {
          path: '/__brand',
          lazy: async () => {
            const { BrandGallery } =
              await import('@/components/dev/BrandGallery');
            return { Component: BrandGallery };
          },
        },
      ]
    : []),
]);
