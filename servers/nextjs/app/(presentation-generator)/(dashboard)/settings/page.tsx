import React from 'react'
import SettingPage from './SettingPage'
import { requireAdminSession } from '@/utils/serverAuth'

export const metadata = {
  title: 'Settings | Presenton',
  description: 'Settings page',
}
const page = async () => {
  await requireAdminSession()

  return (
    <SettingPage />
  )
}

export default page
