import prompts from 'prompts';
import os from 'node:os';
import { FEM_COURSE_REG, SUPPORTED_FORMATS, QUALITY_FORMAT } from '../constants.js';
import { safeJoin, isPathExists } from './common.js';

const env = process.env;
const exitOnCancel = state => {
    if (state.aborted) process.nextTick(() => process.exit(0))
};

export const defaultPrompts = () => {
    return prompts([{
        type: 'text',
        name: 'COURSE_SLUG',
        message: 'The url of the course you want to download',
        initial: env['FEM_DL_COURSE_URL'] || 'https://frontendmasters.com/courses/...',
        validate: v => !v.endsWith('...') && FEM_COURSE_REG.test(v),
        format: v => v.match(FEM_COURSE_REG)[2],
        onState: exitOnCancel
    }, {
        type: 'password',
        name: 'TOKEN',
        message: 'Paste the value of "fem_auth_mod" cookie (visit: https://frontendmasters.com)',
        format: v => decodeURIComponent(v) === v ? encodeURIComponent(v) : v,
        initial: env['FEM_DL_COOKIES'],
        onState: exitOnCancel
    }, {
        type: 'select',
        name: 'PREFERRED_QUALITY',
        message: 'Which stream quality do you prefer?',
        choices: [2160, 1440, 1080, 720, 360].map((value) => ({ title: value + 'p', value })),
        format: v => QUALITY_FORMAT[v],
        onState: exitOnCancel
    }, {
        type: 'select',
        message: 'Which video format you prefer?',
        name: 'EXTENSION',
        initial: 1,
        choices: SUPPORTED_FORMATS.map((value) => ({ title: value, value })),
        onState: exitOnCancel
    }, {
        type: 'confirm',
        initial: true,
        name: 'INCLUDE_CAPTION',
        message: 'Include episode caption?',
        onState: exitOnCancel
    },
    {
        type: 'confirm',
        initial: false,
        name: 'DOWNLOAD_SPECIFIC_LESSON',
        message: 'Do you want to download specific lesson(s)?',
        onState: exitOnCancel
    },
    {
        type: 'text',
        message: 'Download directory path',
        name: 'DOWNLOAD_DIR',
        initial: env['FEM_DL_DOWNLOAD_PATH'] || safeJoin(os.homedir(), 'Downloads'),
        validate: v => isPathExists(v),
        onState: exitOnCancel
    }]);
}

/**
 * Ask user to select multiple lessons to download
 * @param {string[]} lessonNames
 * @returns {Promise<string[]>}
 */
export const selectLessonsPrompt = async (lessonNames = []) => {
    const { selectedLessons } =     await prompts([{
        type: 'multiselect',
        name: 'selectedLessons',
        hint: '- Press Space to select or unselect. Return to submit',
        message: 'Select the lesson(s) to download',
        choices: lessonNames.map(lessonName => ({
            title: lessonName,
            value: lessonName,
        })),
        onState: exitOnCancel,
        instructions: false,
        optionsPerPage: 20,
    }]);
    return selectedLessons;
};