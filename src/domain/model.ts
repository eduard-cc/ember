import Papa from 'papaparse';
import type {Dataset, Workout, SetRecord, ExerciseType, ExerciseSession, TrendPoint, Metric, Comparable} from './types';
export function getExercises(dataset:Dataset):string[]{
  return [...new Set(dataset.workouts.flatMap(workout=>workout.exercises.map(exercise=>exercise.name)))].sort((a,b)=>a.localeCompare(b));
}
export function getHistory(dataset:Dataset,name:string):ExerciseSession[]{
  return dataset.workouts.flatMap(workout=>workout.exercises.filter(exercise=>exercise.name===name).map(exercise=>({workoutId:workout.id,workoutName:workout.name,date:workout.date,type:exercise.type,sets:exercise.sets}))).sort((a,b)=>b.date.localeCompare(a.date));
}
export function getTrend(dataset:Dataset,name:string,metric:Metric):TrendPoint[]{
  return getHistory(dataset,name).flatMap(session=>{
    const values = session.sets.filter(set=>!set.excluded).map(set=>metric==='e1rm' ? estimate1RM(set,session.type) : metric==='volume' ? setVolume(set,session.type) : metric==='reps' ? set.reps : set.weight).filter((value):value is number=>value!==null && Number.isFinite(value) && value>=0);
    if (!values.length) return [];
    return [{workoutId:session.workoutId,date:session.date,value:metric==='volume'?values.reduce((total,value)=>total+value,0):metric==='load' && session.type==='assisted'?Math.min(...values):Math.max(...values)}];
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
export function bestComparable(dataset:Dataset,name:string,weight:number|null):Comparable|null{
  const candidates = getHistory(dataset,name).flatMap(session=>session.sets.filter(set=>!set.excluded && set.weight===weight && set.reps!==null && set.reps>0).map(set=>({set,workoutId:session.workoutId,workoutName:session.workoutName,date:session.date})));
  candidates.sort((a,b)=>(b.set.reps??0)-(a.set.reps??0)||b.date.localeCompare(a.date));
  return candidates[0] ?? null;
}
export function classifyExercise(name: string, sets: SetRecord[]): ExerciseType {
  if (/assisted/i.test(name)) return 'assisted';
  if (/^(Pull Up|Triceps Dip|Chest Dip|Push Up|Sit Up|Hanging Leg Raise)(?:$|\s*\()/i.test(name)) return 'bodyweight';
  if (sets.some(set => set.distance !== null && set.distance > 0)) return 'cardio';
  if (sets.some(set => set.weight !== null && set.weight > 0)) return 'weighted';
  if (sets.some(set => set.seconds !== null && set.seconds > 0)) return 'duration';
  return 'bodyweight';
}
export function estimate1RM(set: SetRecord, type: ExerciseType): number|null {
  if (type !== 'weighted' || set.excluded || set.weight === null || set.weight <= 0 || set.reps === null || !Number.isInteger(set.reps) || set.reps < 1 || set.reps > 10) return null;
  const value = set.reps === 1 ? set.weight : set.weight*(1+set.reps/30);
  return Number.isFinite(value) ? value : null;
}
export function setVolume(set: SetRecord, type: ExerciseType): number|null {
  if (type !== 'weighted' || set.excluded || set.weight === null || set.weight < 0 || set.reps === null || set.reps < 1) return null;
  const value = set.weight*set.reps;
  return Number.isFinite(value) ? value : null;
}

export function parseStrongCsv(text: string): Dataset {
  const result = Papa.parse<Record<string,string>>(text.replace(/^\uFEFF/, ''), {header:true, skipEmptyLines:'greedy'});
  const fields = result.meta.fields ?? [];
  const required = ['Date','Workout Name','Exercise Name','Set Order','Weight','Weight Unit','Reps','Seconds','Workout Duration'];
  if (required.some(field => !fields.includes(field))) throw new Error('This is not a supported Strong export. Export your workout history as CSV and try again.');
  if (result.errors.length) throw new Error('The CSV has malformed or uneven rows. The current history was not changed.');
  if (!result.data.length) throw new Error('The CSV contains no workout sets.');
  const workouts = new Map<string, Workout>();
  const exact = new Set<string>();
  const keys = new Set<string>();
  const warnings = {duplicateRows:0, duplicateKeys:0, suspiciousRows:0, unparsedRows:0};
  result.data.forEach((row,index) => {
    if (!row['Workout Name']?.trim() || !row['Exercise Name']?.trim()) throw new Error(`Row ${index+2} is missing a workout or exercise name.`);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.Date) || !Number.isFinite(Date.parse(row.Date.replace(' ','T')+'Z')) || new Date(row.Date.replace(' ','T')+'Z').toISOString().slice(0,19) !== row.Date.replace(' ','T')) throw new Error(`Row ${index+2} has an invalid local timestamp.`);
    if (row.Weight?.trim() && !['kg','lbs','lb'].includes(row['Weight Unit'])) throw new Error(`Row ${index+2} has an unsupported weight unit.`);
    const durationText = row['Workout Duration'].trim();
    const durationParts = /^(?:(\d+(?:\.\d+)?)h\s*)?(?:(\d+(?:\.\d+)?)m\s*)?(?:(\d+(?:\.\d+)?)s)?$/.exec(durationText);
    if (!durationParts) throw new Error(`Row ${index+2} has an invalid workout duration.`);
    const duration = Number(durationParts[1] ?? 0)*60 + Number(durationParts[2] ?? 0) + Number(durationParts[3] ?? 0)/60;
    if (!Number.isFinite(duration)) throw new Error(`Row ${index+2} has an invalid workout duration.`);
    const sessionKey = JSON.stringify([row.Date,row['Workout Name']]);
    let workout = workouts.get(sessionKey);
    if (!workout) {
      workout = {id:`csv-${sessionKey}`, name:row['Workout Name'], date:row.Date.replace(' ','T'), duration, exercises:[]};
      workouts.set(sessionKey,workout);
    }
    let exercise = workout.exercises.find(ex => ex.name === row['Exercise Name']);
    if (!exercise) {exercise = {name:row['Exercise Name'],type:'weighted',sets:[]};workout.exercises.push(exercise);}
    const number = (value:string|undefined) => {
      if (!value?.trim()) return null;
      const normalized = value.trim().replace(',','.');
      if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) throw new Error(`Row ${index+2} has an invalid numeric value.`);
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed)) throw new Error(`Row ${index+2} has an invalid numeric value.`);
      return parsed;
    };
    const set: SetRecord = {id:`csv-row-${index+1}`, weight:number(row.Weight), reps:number(row.Reps), seconds:number(row.Seconds), distance:number(row.Distance), original:{...row}};
    if (set.weight !== null && ['lb','lbs'].includes(row['Weight Unit'])) set.weight *= 0.45359237;
    if (set.distance !== null) {
      const unit = row['Distance Unit'];
      if (!['km','m','mi','mile','miles'].includes(unit)) throw new Error(`Row ${index+2} has an unsupported distance unit.`);
      if (unit === 'm') set.distance /= 1000;
      if (['mi','mile','miles'].includes(unit)) set.distance *= 1.609344;
    }
    if ([set.weight,set.reps,set.seconds,set.distance].some(value=>value!==null && !Number.isFinite(value))) throw new Error(`Row ${index+2} exceeds the supported numeric range after unit conversion.`);
    set.suspicious = (set.weight !== null && (set.weight < 0 || set.weight > 400)) || (set.reps !== null && (set.reps < 0 || set.reps > 50 || !Number.isInteger(set.reps))) || (set.seconds !== null && set.seconds < 0) || (set.distance !== null && set.distance < 0);
    if (set.suspicious) warnings.suspiciousRows++;
    exercise.sets.push(set);
    const exactKey = JSON.stringify(row);
    if (exact.has(exactKey)) warnings.duplicateRows++; exact.add(exactKey);
    const key = JSON.stringify([row.Date,row['Workout Name'],row['Exercise Name'],row['Set Order']]);
    if (keys.has(key)) warnings.duplicateKeys++; keys.add(key);
  });
  const values = [...workouts.values()];
  values.forEach(workout => workout.exercises.forEach(exercise => {exercise.type = classifyExercise(exercise.name, exercise.sets);}));
  return {sourceLabel:'Strong CSV',workouts:values.sort((a,b)=>b.date.localeCompare(a.date)),warnings};
}
