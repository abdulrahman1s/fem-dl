import enquirer from 'enquirer';

const { MultiSelect } = enquirer;

/**
 * Ask user to select multiple lessons to download
 * @param {string[]} lessonNames
 * @returns {Promise<string[]>}
 */
export const selectLessonsPrompt = async (lessonNames = []) => {
    const prompt = new MultiSelect({
        name: 'selectedLessons',
        message: 'Select the lesson(s) to download',
        choices: lessonNames.map(lessonName => ({
            name: lessonName,
            value: lessonName,
        })),
        onCancel: () => process.nextTick(() => process.exit(0))
    });
    const selectedLessons = await prompt.run();
    return selectedLessons;
};