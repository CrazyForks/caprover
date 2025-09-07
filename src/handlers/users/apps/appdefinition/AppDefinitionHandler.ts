import DataStore from '../../../../datastore/DataStore'
import { ICaptainDefinition } from '../../../../models/ICaptainDefinition'
import ServiceManager from '../../../../user/ServiceManager'
import CaptainConstants from '../../../../utils/CaptainConstants'
import Logger from '../../../../utils/Logger'

import ApiStatusCodes from '../../../../api/ApiStatusCodes'
import {
    AppDeployTokenConfig,
    IAppEnvVar,
    IAppPort,
    IAppTag,
    IAppVolume,
    IHttpAuth,
    RepoInfo,
} from '../../../../models/AppDefinition'
import { BaseHandlerResult } from '../../../BaseHandlerResult'

export interface RegisterAppDefinitionParams {
    appName: string
    projectId: string
    hasPersistentData: boolean
    isDetachedBuild: boolean
}

export async function registerAppDefinition(
    params: RegisterAppDefinitionParams,
    dataStore: DataStore,
    serviceManager: ServiceManager
): Promise<BaseHandlerResult> {
    const { appName, projectId, hasPersistentData, isDetachedBuild } = params
    let appCreated = false

    Logger.d(`Registering app started: ${appName}`)

    try {
        // Validate project if projectId is provided
        if (projectId) {
            await dataStore.getProjectsDataStore().getProject(projectId)
            // if project is not found, it will throw an error
        }

        // Register the app definition
        await dataStore
            .getAppsDataStore()
            .registerAppDefinition(appName, projectId, hasPersistentData)

        appCreated = true

        // Create captain definition content
        const captainDefinitionContent: ICaptainDefinition = {
            schemaVersion: 2,
            imageName: CaptainConstants.configs.appPlaceholderImageName,
        }

        // Schedule deployment (unless detached build)
        const promiseToIgnore = serviceManager
            .scheduleDeployNewVersion(appName, {
                captainDefinitionContentSource: {
                    captainDefinitionContent: JSON.stringify(
                        captainDefinitionContent
                    ),
                    gitHash: '',
                },
            })
            .catch(function (error) {
                Logger.e(error)
            })

        if (!isDetachedBuild) {
            await promiseToIgnore
        }

        Logger.d(`AppName is saved: ${appName}`)

        return {
            message: 'App Definition Saved',
        }
    } catch (error: any) {
        // Cleanup if app was created but something failed
        if (appCreated) {
            try {
                await dataStore.getAppsDataStore().deleteAppDefinition(appName)
            } catch (cleanupError) {
                Logger.e(
                    `Failed to cleanup app definition after error: ${cleanupError}`
                )
            }
        }

        // Re-throw the error
        throw error
    }
}

export interface GetAllAppDefinitionsResult extends BaseHandlerResult {
    data: {
        appDefinitions: any[]
        rootDomain: string
        captainSubDomain: string
        defaultNginxConfig: any
    }
}

export async function getAllAppDefinitions(
    dataStore: DataStore,
    serviceManager: ServiceManager
): Promise<GetAllAppDefinitionsResult> {
    Logger.d('Getting all app definitions started')

    try {
        const apps = await dataStore.getAppsDataStore().getAppDefinitions()
        const appsArray: any[] = []

        Object.keys(apps).forEach(function (key) {
            const app = apps[key]
            app.appName = key
            app.isAppBuilding = serviceManager.isAppBuilding(key)
            app.appPushWebhook = app.appPushWebhook || undefined
            appsArray.push(app)
        })

        const defaultNginxConfig = await dataStore.getDefaultAppNginxConfig()

        Logger.d(`App definitions retrieved: ${appsArray.length} apps`)

        return {
            message: 'App definitions are retrieved.',
            data: {
                appDefinitions: appsArray,
                rootDomain: dataStore.getRootDomain(),
                captainSubDomain: CaptainConstants.configs.captainSubDomain,
                defaultNginxConfig: defaultNginxConfig,
            },
        }
    } catch (error: any) {
        Logger.e(`Failed to get app definitions: ${error}`)
        throw error
    }
}

export interface UpdateAppDefinitionParams {
    appName: string
    projectId?: string
    description?: string
    instanceCount?: number | string
    captainDefinitionRelativeFilePath?: string
    envVars?: IAppEnvVar[]
    volumes?: IAppVolume[]
    tags?: IAppTag[]
    nodeId?: string
    notExposeAsWebApp?: boolean
    containerHttpPort?: number | string
    httpAuth?: any
    forceSsl?: boolean
    ports?: IAppPort[]
    repoInfo?: RepoInfo | any
    customNginxConfig?: string
    redirectDomain?: string
    preDeployFunction?: string
    serviceUpdateOverride?: string
    websocketSupport?: boolean
    appDeployTokenConfig?: AppDeployTokenConfig
}

export async function updateAppDefinition(
    params: UpdateAppDefinitionParams,
    serviceManager: ServiceManager
): Promise<BaseHandlerResult> {
    const {
        appName,
        projectId,
        description,
        instanceCount,
        captainDefinitionRelativeFilePath,
        envVars,
        volumes,
        tags,
        nodeId,
        notExposeAsWebApp,
        containerHttpPort,
        httpAuth,
        forceSsl,
        ports,
        repoInfo: inputRepoInfo,
        customNginxConfig,
        redirectDomain,
        preDeployFunction,
        serviceUpdateOverride,
        websocketSupport,
        appDeployTokenConfig,
    } = params

    // Defaults & normalization
    const normalizedDescription = `${description || ''}`
    const instanceCountNum = Number(instanceCount ?? 0)
    const containerHttpPortNum = Number(containerHttpPort) || 80
    const normalizedEnvVars = envVars || []
    const normalizedVolumes = volumes || []
    const normalizedTags = tags || []
    const normalizedPorts = ports || []
    const normalizedNotExposeAsWebApp = !!notExposeAsWebApp
    const normalizedForceSsl = !!forceSsl
    const normalizedWebsocketSupport = !!websocketSupport
    const normalizedRedirectDomain = `${redirectDomain || ''}`
    const normalizedPreDeployFunction = `${preDeployFunction || ''}`
    const normalizedServiceUpdateOverride = `${serviceUpdateOverride || ''}`

    let normalizedDeployTokenConfig: AppDeployTokenConfig | undefined
    if (!appDeployTokenConfig) {
        normalizedDeployTokenConfig = { enabled: false }
    } else {
        normalizedDeployTokenConfig = {
            enabled: !!appDeployTokenConfig.enabled,
            appDeployToken: `${
                appDeployTokenConfig.appDeployToken
                    ? appDeployTokenConfig.appDeployToken
                    : ''
            }`.trim(),
        }
    }

    const repoInfo: any = inputRepoInfo || {}

    if (repoInfo.user) {
        repoInfo.user = repoInfo.user.trim()
    }
    if (repoInfo.repo) {
        repoInfo.repo = repoInfo.repo.trim()
    }
    if (repoInfo.branch) {
        repoInfo.branch = repoInfo.branch.trim()
    }

    if (
        (repoInfo.branch ||
            repoInfo.user ||
            repoInfo.repo ||
            repoInfo.password ||
            repoInfo.sshKey) &&
        (!repoInfo.branch ||
            !repoInfo.repo ||
            (!repoInfo.sshKey && !repoInfo.user && !repoInfo.password) ||
            (repoInfo.password && !repoInfo.user) ||
            (repoInfo.user && !repoInfo.password))
    ) {
        throw ApiStatusCodes.createError(
            ApiStatusCodes.ILLEGAL_PARAMETER,
            'Missing required Github/BitBucket/Gitlab field'
        )
    }

    if (
        repoInfo &&
        repoInfo.sshKey &&
        repoInfo.sshKey.indexOf('ENCRYPTED') > 0 &&
        !CaptainConstants.configs.disableEncryptedCheck
    ) {
        throw ApiStatusCodes.createError(
            ApiStatusCodes.ILLEGAL_PARAMETER,
            'You cannot use encrypted SSH keys'
        )
    }

    if (
        repoInfo &&
        repoInfo.sshKey &&
        repoInfo.sshKey.indexOf('END OPENSSH PRIVATE KEY-----') > 0
    ) {
        repoInfo.sshKey = repoInfo.sshKey.trim()
        repoInfo.sshKey = repoInfo.sshKey + '\n'
    }

    Logger.d(`Updating app started: ${appName}`)

    await serviceManager.updateAppDefinition(
        appName,
        `${projectId || ''}`,
        normalizedDescription,
        instanceCountNum,
        `${captainDefinitionRelativeFilePath || ''}`,
        normalizedEnvVars,
        normalizedVolumes,
        normalizedTags,
        `${nodeId || ''}`,
        normalizedNotExposeAsWebApp,
        containerHttpPortNum,
        httpAuth as IHttpAuth,
        normalizedForceSsl,
        normalizedPorts,
        repoInfo,
        `${customNginxConfig || ''}`,
        normalizedRedirectDomain,
        normalizedPreDeployFunction,
        normalizedServiceUpdateOverride,
        normalizedWebsocketSupport,
        normalizedDeployTokenConfig
    )

    Logger.d(`AppName is updated: ${appName}`)

    return {
        message: 'Updated App Definition Saved',
    }
}
