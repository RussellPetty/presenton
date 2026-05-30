import { redirect } from 'next/navigation'

// Settings is intentionally hidden in this deployment: provider keys are managed
// via environment configuration, not the in-app UI. Any direct navigation to
// /settings is sent back to the dashboard. (SettingPage component is retained
// but no longer mounted.)
const page = () => {
  redirect('/dashboard')
}

export default page
