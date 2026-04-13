// Copyright © 2026 Joe Pruskowski. All rights reserved.
export function envCommand(program) {
  program
    .command('env')
    .description('Show the current runtime environment (local or Railway)')
    .action(() => {
      const railwayEnv  = process.env.RAILWAY_ENVIRONMENT
      const projectName = process.env.RAILWAY_PROJECT_NAME
      const serviceName = process.env.RAILWAY_SERVICE_NAME
      const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN
      const nodeEnv     = process.env.NODE_ENV ?? 'development'
      const dbUrl       = process.env.DATABASE_URL ?? ''

      if (railwayEnv) {
        console.log(`Environment : Railway — ${railwayEnv}`)
        if (projectName)  console.log(`Project     : ${projectName}`)
        if (serviceName)  console.log(`Service     : ${serviceName}`)
        if (publicDomain) console.log(`Domain      : ${publicDomain}`)
      } else {
        console.log('Environment : local')
      }

      console.log(`NODE_ENV    : ${nodeEnv}`)

      // Show DB host without credentials
      if (dbUrl) {
        try {
          const { host, port, pathname } = new URL(dbUrl)
          console.log(`Database    : ${host}${port ? `:${port}` : ''}${pathname}`)
        } catch {
          console.log('Database    : (unable to parse DATABASE_URL)')
        }
      } else {
        console.log('Database    : (DATABASE_URL not set)')
      }
    })
}
